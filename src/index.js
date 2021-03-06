process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://634828219d7842f4b9574a85f6f63f76@sentry.cozycloud.cc/120'

const {
  BaseKonnector,
  requestFactory,
  errors,
  log,
  retry
} = require('cozy-konnector-libs')
const requestHTML = requestFactory({
  debug: false,
  cheerio: true,
  json: false,
  jar: true
})
const requestJSON = requestFactory({
  debug: false,
  cheerio: false,
  json: true,
  jar: true
})

const baseUrl = 'https://wwwd.caf.fr'
const lastDayOfMonth = require('date-fns').lastDayOfMonth
const subMonths = require('date-fns').subMonths

module.exports = new BaseKonnector(start)

async function start(fields) {
  await this.deactivateAutoSuccessfulLogin()
  fields.login = normalizeLogin(fields.login)
  log('info', 'Authenticating ...')
  let codeOrga
  try {
    codeOrga = await retry(authenticate, {
      backoff: 3,
      throw_original: true,
      context: this,
      args: [fields.login, fields.zipcode, fields.born, fields.password]
    })
  } catch (e) {
    if (e.message === 'LOGIN_FAILED' || e.message.includes('CGU_FORM')) {
      throw e
    } else {
      log('error', e.message)
      throw new Error(errors.VENDOR_DOWN)
    }
  }
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of documents')
  const token = (await requestJSON(`${baseUrl}/wps/s/GenerateTokenJwt/`))
    .cnafTokenJwt

  const paiements = (await requestJSON(
    `${baseUrl}/api/paiementsfront/v1/mon_compte/paiements?cache=${codeOrga}_${fields.login}`,
    {
      headers: {
        Authorization: token
      }
    }
  )).paiements

  log('info', 'Parsing bills')
  const bills = await parseDocuments(paiements, token)

  log('info', 'Parsing attestation')
  const files = await parseAttestation(token)

  log('info', 'Saving data to Cozy')
  await this.saveBills(bills, fields, {
    contentType: 'application/pdf',
    linkBankOperations: false,
    fileIdAttributes: ['date', 'amount']
  })
  // Only one attestation send, replaced each time
  await this.saveFiles(files, fields, {
    fileIdAttributes: ['filename']
  })
}

async function authenticate(login, zipcode, born, password) {
  if (
    login == '' ||
    login == null ||
    zipcode == '' ||
    zipcode == null ||
    born == '' ||
    born == null ||
    password == '' ||
    password == null
  ) {
    log('error', 'Some fields are not defined')
    throw new Error(errors.LOGIN_FAILED)
  }

  // Reset / Create session
  await requestHTML('https://wwwd.caf.fr', {
    resolveWithFullResponse: true
  })
  log('debug', 'First signature')

  // Ask for authorization
  let token
  try {
    token = (await requestJSON(`${baseUrl}/wps/s/GenerateTokenJwtPublic/`))
      .cnafTokenJwt
  } catch (err) {
    log('error', err.message)
    throw new Error(errors.VENDOR_DOWN)
  }
  log('debug', 'Got JWT, ask zipCode')

  // Retreive codeOrga :
  let listeCommunes
  try {
    listeCommunes = (await requestJSON(
      `${baseUrl}/api/connexionmiddle/v1/communes/${zipcode}`,
      {
        headers: { Authorization: token }
      }
    )).listeCommunes
  } catch (err) {
    log('error', err.message)
    throw new Error(errors.VENDOR_DOWN)
  }

  if (listeCommunes.length === 0) {
    log('error', 'Zip code is not valid or does not exist')
    throw new Error(errors.LOGIN_FAILED)
  }

  const codeOrga = listeCommunes[0].codeOrganisme

  // Correspondences : caseCssClass / digit
  const assocClassDigit = [
    { digit: '0', class: 'case-xt' },
    { digit: '1', class: 'case-xy' },
    { digit: '2', class: 'case-xw' },
    { digit: '3', class: 'case-xq' },
    { digit: '4', class: 'case-xz' },
    { digit: '5', class: 'case-xs' },
    { digit: '6', class: 'case-xu' },
    { digit: '7', class: 'case-xx' },
    { digit: '8', class: 'case-xr' },
    { digit: '9', class: 'case-xv' }
  ]

  log('debug', 'Getting clavier_virtuel')
  // Retrieve correspondences : caseCssClass / letter
  let assocClassLetter
  try {
    assocClassLetter = (await requestJSON(
      `${baseUrl}/api/connexionmiddle/v1/clavier_virtuel?nb_cases=15`,
      {
        headers: {
          Authorization: token
        }
      }
    )).listeCase
  } catch (err) {
    log('error', err)
    throw new Error(errors.VENDOR_DOWN)
  }

  // Parse password
  const parsedPassword = parsePassword(
    password,
    assocClassLetter,
    assocClassDigit
  )

  log('debug', 'Launching POST')
  // Authentication with all fields
  await requestHTML(`${baseUrl}/wps/session/RefreshSession.jsp`)
  const authResp = await requestJSON({
    url: `${baseUrl}/api/connexionmiddle/v1/verifier_mdp`,
    gzip: true,
    headers: {
      Authorization: token
    },
    method: 'POST',
    json: {
      codeOrga,
      jourMoisNaissance: born,
      matricule: login,
      positions: parsedPassword,
      modeAccessible: false,
      origineDemande: 'WEB'
    }
  })

  if (authResp.cguAValider === true) {
    throw new Error('USER_ACTION_NEEDED.CGU_FORM')
  }

  // Check if connected
  log('debug', 'Checking for login')
  const response = await requestHTML(
    'https://wwwd.caf.fr/wps/myportal/caffr/moncompte/tableaudebord',
    {
      resolveWithFullResponse: true
    }
  )

  if (
    !response.request.uri.href.includes(
      `${baseUrl}/wps/myportal/caffr/moncompte/tableaudebord`
    )
  ) {
    log(
      'error',
      'An error occured while trying to connect with the given identifiers'
    )
    throw new Error(errors.LOGIN_FAILED)
  }
  await this.notifySuccessfulLogin()

  return codeOrga
}

async function parseDocuments(docs, token) {
  let bills = []
  for (var i = 0; i < docs.length; i++) {
    const dateElab = parseDate(docs[i].dateElaboration)
    const [yearElab, monthElab] = dateToYearMonth(dateElab)
    // Get last day of the month for the request
    const lastDayElab = daysInMonth(monthElab, yearElab)

    const date = parseDate(docs[i].dateEmission)
    const amount = parseAmount(docs[i].montantPaiement)

    // Create bill for paiement
    bills.push({
      date,
      amount,
      isRefund: true,
      currency: '€',
      requestOptions: {
        // The PDF required an authorization
        headers: {
          Authorization: token
        }
      },
      vendor: 'caf',
      fileurl: `${baseUrl}/api/attestationsfront/v1/mon_compte/attestation_sur_periode/paiements/${yearElab}${monthElab}01/${yearElab}${monthElab}${lastDayElab}`,
      filename: `${formatShortDate(
        dateElab
      )}_caf_attestation_paiement_${amount.toFixed(2)}€.pdf`,
      fileAttributes: {
        metadata: {
          carbonCopy: true
        }
      }
    })
  }
  return bills
}

async function parseAttestation(token) {
  const today = Date.now()
  const lastMonth = subMonths(today, 1)
  const [year, month] = dateToYearMonth(lastMonth)
  const lastDay = daysInMonth(month, year)

  // A array with one element
  return [
    {
      shouldReplaceFile: () => true,
      requestOptions: {
        // The PDF required an authorization
        headers: {
          Authorization: token
        }
      },
      fileurl: `${baseUrl}/api/attestationsfront/v1/mon_compte/attestation_sur_periode/qf/${year}${month}01/${year}${month}${lastDay}`,
      filename: `caf_attestation_quotient_familial.pdf`,
      fileAttributes: {
        metadata: {
          carbonCopy: true
        }
      }
    }
  ]
}

function parsePassword(password, assocClassLetter, assocClassDigit) {
  var assocLetterDigit = []
  for (var l = 0; l < assocClassLetter.length; l++) {
    for (var d = 0; d < assocClassDigit.length; d++) {
      if (assocClassDigit[d].class == assocClassLetter[l].classCss) {
        assocLetterDigit.push({
          letter: assocClassLetter[l].position,
          digit: assocClassDigit[d].digit
        })
      }
    }
  }

  let parsedPassword = ''
  for (var c = 0; c < password.length; c++) {
    for (var a = 0; a < assocLetterDigit.length; a++) {
      if (password[c] == assocLetterDigit[a].digit) {
        parsedPassword += assocLetterDigit[a].letter
      }
    }
  }

  return parsedPassword
}

// Convert a Date object to a ISO date string
function formatShortDate(date) {
  let year = date.getFullYear()
  let month = date.getMonth() + 1
  if (month < 10) {
    month = '0' + month
  }
  return `${year}-${month}`
}

// Convert a date from format Ymmdd  to Date object
function parseDate(text) {
  const y = text.substr(0, 4)
  const m = parseInt(text.substr(4, 2), 10)
  const d = parseInt(text.substr(6, 2), 10)
  return new Date(y, m - 1, d)
}

// Convert date object to Ymm
function dateToYearMonth(date) {
  let month = date.getMonth() + 1
  if (month < 10) {
    month = '0' + month
  }
  const year = date.getFullYear()

  return [year, month]
}

function parseAmount(amount) {
  return parseFloat(amount.replace(',', '.'))
}

// Return number of days in the month
// Month arg is natural month number here (1-indexed) and Date arg is 0-indexed
function daysInMonth(month, year) {
  return lastDayOfMonth(new Date(year, month - 1, 1)).getDate()
}

function normalizeLogin(login) {
  if (login && login.length < 7 && login.padStart) {
    log('info', 'Had to normalize login length to 7 chars')
    return login.padStart(7, '0')
  }

  return login
}
