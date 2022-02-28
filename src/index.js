process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://022abee095bc40ea928c610cf0bdbe8d@errors.cozycloud.cc/21'

const {
  BaseKonnector,
  requestFactory,
  errors,
  log,
  retry,
  utils,
  cozyClient
} = require('cozy-konnector-libs')

const models = cozyClient.new.models
const { Qualification } = models.document

const requestHTML = requestFactory({
  // debug: true,
  cheerio: true,
  json: false,
  jar: true
})
const requestJSON = requestFactory({
  // debug: true,
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
  let LtpaToken2
  try {
    LtpaToken2 = await retry(authenticate, {
      backoff: 3,
      throw_original: true,
      context: this,
      args: [fields.login, fields.password]
    })
  } catch (e) {
    if (e.message === 'LOGIN_FAILED' || e.message.includes('CGU_FORM')) {
      throw e
    } else if (e.statusCode === 400) {
      // Theres is modifications on the website regarding the login format.
      // Now we need to input the social security number without the last 2 characters.
      if (fields.login.length < 13 || fields.login.length > 13) {
        log('error', 'Your login must be 13 characters')
        throw new Error(errors.LOGIN_FAILED)
      } else {
        log('error', 'something went wrong with your credentials')
        throw new Error(errors.LOGIN_FAILED)
      }
    } else if (e.statusCode === 403) {
      log('error', 'something went wrong with your credentials')
      throw new Error(errors.LOGIN_FAILED)
    } else {
      log('error', e.message)
      throw new Error(errors.VENDOR_DOWN)
    }
  }
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of documents')

  const token = await requestJSON({
    url: `${baseUrl}/wps/s/GenerateTokenJwt/`,
    headers: {
      Cookie: `${LtpaToken2}`
    },
    method: 'GET'
  })

  const parsedCnafToken = token
  let cnafToken = parsedCnafToken.cnafTokenJwt

  const getPaiements = await requestJSON(
    `${baseUrl}/api/paiementsfront/v1/mon_compte/paiements`,
    {
      headers: {
        Authorization: `${cnafToken}`
      },
      method: 'GET'
    }
  )
  const paiements = getPaiements.paiements

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

async function authenticate(login, password) {
  if (login == '' || login == null || password == '' || password == null) {
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
  log('debug', 'Got JWT')

  log('debug', 'Launching POST')

  // Authentication with all fields

  await requestHTML(`${baseUrl}/wps/session/RefreshSession.jsp`)

  const authResp = await requestJSON({
    url: `${baseUrl}/api/connexionmiddle/v3/connexion_personne`,
    gzip: true,
    headers: {
      Authorization: token
    },
    method: 'POST',
    json: {
      identifiant: login,
      motDePasse: password,
      origineDemande: 'WEB',
      captcha: '',
      contexteAppel: 'caffr'
    }
  })

  if (authResp.cguAValider === true) {
    throw new Error('USER_ACTION_NEEDED.CGU_FORM')
  }

  // Get LtpaToken2 with ccode

  let LtpaToken2 = await requestHTML(
    `https://wwwd.caf.fr/wpc-connexionportail-web/s/AccesPortail?urlredirect=/wps/myportal/caffr/moncompte/tableaudebord&ccode=${authResp.ccode}`,
    {
      resolveWithFullResponse: true
    }
  )
  LtpaToken2 = LtpaToken2.request.headers.cookie

  // Check if connected
  log('debug', 'Checking for login')
  const response = await requestHTML(
    'https://wwwd.caf.fr/wps/myportal/caffr/moncompte/tableaudebord',
    {
      resolveWithFullResponse: true
    }
  )
  if (
    !response.request._rp_options.uri.includes(
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

  // Must return LtpaToken2 now with CnafTokenJWT
  return LtpaToken2, token
}

async function parseDocuments(docs, token) {
  await requestHTML(`${baseUrl}/wps/myportal/caffr/moncompte/mesattestations`, {
    headers: {
      Authorization: token
    },
    resolveWithFullResponse: true
  })

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
          Authorization: token.cnafTokenJwt
        }
      },
      vendor: 'caf',
      fileurl: `${baseUrl}/api/attestationsfront/v1/mon_compte/attestation_sur_periode/paiements/${yearElab}${monthElab}01/${yearElab}${monthElab}${lastDayElab}`,
      filename: `${formatShortDate(
        dateElab
      )}_caf_attestation_paiement_${amount.toFixed(2)}€.pdf`,
      fileAttributes: {
        metadata: {
          contentAuthor: 'caf.fr',
          issueDate: utils.formatDate(new Date()),
          datetimeLabel: 'issuDate',
          isSubscription: false,
          carbonCopy: true,
          qualification: Qualification.getByLabel(
            'payment_proof_family_allowance'
          )
        }
      }
    })
  }
  return bills
}

async function parseAttestation(token) {
  await requestHTML(`${baseUrl}/wps/myportal/caffr/moncompte/mesattestations`, {
    resolveWithFullResponse: true
  })
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
          Authorization: token.cnafTokenJwt
        }
      },
      fileurl: `${baseUrl}/api/attestationsfront/v1/mon_compte/attestation_sur_periode/qf/${year}${month}01/${year}${month}${lastDay}`,
      filename: `caf_attestation_quotient_familial.pdf`,
      fileAttributes: {
        metadata: {
          contentAuthor: 'caf.fr',
          issueDate: utils.formatDate(new Date()),
          datetimeLabel: 'issuDate',
          isSubscription: false,
          carbonCopy: true,
          qualification: Qualification.getByLabel('caf')
        }
      }
    }
  ]
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
