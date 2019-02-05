const {
  BaseKonnector,
  requestFactory,
  saveBills,
  errors,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  cheerio: true,
  json: false,
  jar: true
})

const baseUrl = 'https://wwwd.caf.fr'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  const codeOrga = await authenticate(fields.num, fields.zipcode, fields.born, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of documents')
  let token
  await request({
    url: `${baseUrl}/wps/s/GenerateTokenJwt/`
  }, (error, response, body) => {
    token = JSON.parse(body).cnafTokenJwt
  })

  let bills
  await request({
    url: `${baseUrl}/api/paiementsfront/v1/mon_compte/paiements?cache=${codeOrga}_${fields.num}`,
    headers: {
      'Authorization': token
    }
  }, (error, response, body) => {
    bills = JSON.parse(body).paiements
  })

  log('info', 'Parsing list of documents')
  const documents = await parseDocuments(bills, token)

  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields, {
    identifiers: ['caf'],
    contentType: 'application/pdf'
  })
}

async function authenticate(num, zipcode, born, password) {

  // Ask for authorization
  let token
  await request({
    url: `${baseUrl}/wps/s/GenerateTokenJwtPublic/`
  }, (error, response, body) => {
    try {
      token = JSON.parse(body).cnafTokenJwt
    }
    catch (err) {
      throw new Error(errors.VENDOR_DOWN)
    }
  })

  // Retreive codeOrga : 
  let codeOrga
  await request({
    url: `${baseUrl}/api/loginfront/v1/mon_compte/communes/${zipcode}`,
    headers: { 'Authorization': token }
  }, (error, response, body) => {
    if (JSON.parse(body).listeCommunes.length == 0) {
      log('error', 'Zip code is not valid or does not exist')
      throw new Error(errors.LOGIN_FAILED)
    }
    codeOrga = JSON.parse(body).listeCommunes[0].codeOrga
  })

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
    { digit: '9', class: 'case-xv' },
  ]

  // Retreivre correspondences : caseCssClass / letter
  let assocClassLetter
  await request({
    url: `${baseUrl}/wta-portletangular-web/s/clavier_virtuel?nbCases=15`
  }, (error, response, body) => {
    assocClassLetter = JSON.parse(body).listeCase
  })

  // Parse password
  const parsedPassword = parsePassword(password, assocClassLetter, assocClassDigit)

  // Authentication with codeOrga, num, zipcode, born, and password  
  await request({
    url: `${baseUrl}/wta-portletangular-web/s/authentifier_mdp`,
    method: 'POST',
    form: {
      codeOrga: codeOrga,
      jourMoisNaissance: born,
      matricule: num,
      positions: parsedPassword,
      typeCanal: 1
    }
  })

  // Check if connected
  await request(`${baseUrl}/wps/myportal/caffr/moncompte/tableaudebord'`, (e, response, b) => {
    if (!response.request.uri.href.includes(`${baseUrl}/wps/myportal/caffr/moncompte/tableaudebord`)) {
      throw new Error(errors.LOGIN_FAILED)
    }
  })

  return codeOrga
}

async function parseDocuments(docs, token) {

  const actualLength = docs.length

  for (var i = 0; i < actualLength; i++) {
    const [year, month] = dateToYearMonth(parseDate(docs[i].dateElaboration))
    docs[i].date = parseDate(docs[i].dateElaboration)
    docs[i].amount = parseAmount(docs[i].montantPaiement)

    // The PDF required an authorization 
    docs[i].requestOptions = {
      headers: {
        'Authorization': token
      }
    }

    // Get las day of the month for the request
    const lastDay = daysInMonth(docs[i].date.getMonth() + 1, docs[i].date.getFullYear())

    // Create bill for : Attestation de paiement
    docs[i] = {
      date: docs[i].date,
      currency: '€',
      requestOptions: docs[i].requestOptions,
      amount: docs[i].amount,
      vendor: 'caf',
      fileurl: `${baseUrl}/api/attestationsfront/v1/mon_compte/attestation_sur_periode/paiements/${year}${month}01/${year}${month}${lastDay}`,
      filename: `${formatDate(docs[i].date)}_caf_attestation_paiement_${docs[i].amount.toFixed(2)}€.pdf`,
      metadata: {
        importDate: new Date(),
        version: 1
      }
    }

    // Create bill for : Allocation familiale
    docs[docs.length] = {
      date: docs[i].date,
      requestOptions: docs[i].requestOptions,
      vendor: 'caf',
      amount: 0.0,
      fileurl: `${baseUrl}/api/attestationsfront/v1/mon_compte/attestation_sur_periode/qf/${year}${month}01/${year}${month}${lastDay}`,
      filename: `${formatDate(docs[i].date)}_caf_attestation_quotient_familial.pdf`,
      metadata: {
        importDate: new Date(),
        version: 1
      }
    }
  }
  return docs
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
function formatDate(date) {
  let year = date.getFullYear()
  let month = date.getMonth() + 1
  let day = date.getDate()
  if (month < 10) {
    month = '0' + month
  }
  if (day < 10) {
    day = '0' + day
  }
  return `${year}-${month}-${day}`
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
function daysInMonth(month, year) {
  return new Date(year, month, 0).getDate();
}
