process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://634828219d7842f4b9574a85f6f63f76@sentry.cozycloud.cc/120'

const {
  BaseKonnector,
  requestFactory,
  saveBills,
  saveFiles,
  errors,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  //debug: true,
  cheerio: true,
  json: false,
  jar: true
})

const baseUrl = 'https://wwwd.caf.fr'
const lastDayOfMonth = require('date-fns').lastDayOfMonth
const subMonths = require('date-fns').subMonths

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  const codeOrga = await authenticate(
    fields.login,
    fields.zipcode,
    fields.born,
    fields.password
  )
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of documents')
  let token
  await request(
    {
      url: `${baseUrl}/wps/s/GenerateTokenJwt/`
    },
    (error, response, body) => {
      token = JSON.parse(body).cnafTokenJwt
    }
  )

  let paiements
  await request(
    {
      url: `${baseUrl}/api/paiementsfront/v1/mon_compte/paiements?cache=${codeOrga}_${
        fields.login
      }`,
      headers: {
        Authorization: token
      }
    },
    (error, response, body) => {
      paiements = JSON.parse(body).paiements
    }
  )

  log('info', 'Parsing bills')
  const bills = await parseDocuments(paiements, token)

  log('info', 'Parsing attestation')
  const files = await parseAttestation(token)

  log('info', 'Saving data to Cozy')
  await saveBills(bills, fields, {
    identifiers: ['caf'],
    contentType: 'application/pdf'
  })
  // Only one attestation send, replaced each time
  await saveFiles(files, fields)
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
  await request('https://wwwd.caf.fr/wps/portal/caffr/login#/signature')

  // Ask for authorization
  let token
  await request(
    {
      url: `${baseUrl}/wps/s/GenerateTokenJwtPublic/`
    },
    (error, response, body) => {
      try {
        token = JSON.parse(body).cnafTokenJwt
      } catch (err) {
        log('error', err.message)
        throw new Error(errors.VENDOR_DOWN)
      }
    }
  )

  // Retreive codeOrga :
  let codeOrga
  await request(
    {
      url: `${baseUrl}/api/loginfront/v1/mon_compte/communes/${zipcode}`,
      headers: { Authorization: token }
    },
    (error, response, body) => {
      try {
        if (JSON.parse(body).listeCommunes.length == 0) {
          log('error', 'Zip code is not valid or does not exist')
          log('error', body)
          throw new Error(errors.LOGIN_FAILED)
        }
        codeOrga = JSON.parse(body).listeCommunes[0].codeOrga
      } catch (err) {
        log('error', err)
        throw new Error(errors.LOGIN_FAILED)
      }
    }
  )

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

  // Retreivre correspondences : caseCssClass / letter
  let assocClassLetter
  await request(
    {
      url: `${baseUrl}/wta-portletangular-web/s/clavier_virtuel?nbCases=15`
    },
    (error, response, body) => {
      try {
        assocClassLetter = JSON.parse(body).listeCase
      } catch (err) {
        log('error', err)
        log('error', body)
        throw new Error(errors.VENDOR_DOWN)
      }
    }
  )

  // Parse password
  const parsedPassword = parsePassword(
    password,
    assocClassLetter,
    assocClassDigit
  )

  // Authentication with all fields
  await request({
    url: `${baseUrl}/wta-portletangular-web/s/authentifier_mdp`,
    method: 'POST',
    form: {
      codeOrga: codeOrga,
      jourMoisNaissance: born,
      matricule: login,
      positions: parsedPassword,
      typeCanal: 1
    }
  })

  // Check if connected
  await request(
    'https://wwwd.caf.fr/wps/myportal/caffr/moncompte/tableaudebord',
    (error, response) => {
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
    }
  )

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
      metadata: {
        importDate: new Date(),
        version: 1
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
      metadata: {
        importDate: new Date(),
        version: 1
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
