const {
  BaseKonnector,
  requestFactory,
  scrape,
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
  await authenticate(fields.num, fields.zipcode, fields.born, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of documents')
  const $ = await request('https://wwwd.caf.fr/wps/myportal/caffr/moncompte/tableaudebord')
  /*log('info', 'Parsing list of documents')
   const documents = await parseDocuments($)
 
   // here we use the saveBills function even if what we fetch are not bills, but this is the most
   // common case in connectors
   log('info', 'Saving data to Cozy')
   await saveBills(documents, fields, {
     // this is a bank identifier which will be used to link bills to bank operations. These
     // identifiers should be at least a word found in the title of a bank operation related to this
     // bill. It is not case sensitive.
     identifiers: ['books']
   }) */
}

async function authenticate(num, zipcode, born, password) {

  // Ask for authorization
  let token
  await request({
    url: 'https://wwwd.caf.fr/wps/s/GenerateTokenJwtPublic/'
  }, (error, response, body) => {
    token = JSON.parse(body).cnafTokenJwt
  })

  // Retreive codeOrga : 
  let codeOrga
  await request({
    url: `https://wwwd.caf.fr/api/loginfront/v1/mon_compte/communes/${zipcode}`,
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
    url: 'https://wwwd.caf.fr/wta-portletangular-web/s/clavier_virtuel?nbCases=15'
  }, (error, response, body) => {
    assocClassLetter = JSON.parse(body).listeCase
  })

  // Parse password
  const parsedPassword = parsePassword(password, assocClassLetter, assocClassDigit)

  // Authentication with codeOrga, num, zipcode, born, and password  
  await request({
    url: 'https://wwwd.caf.fr/wta-portletangular-web/s/authentifier_mdp',
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
  await request('https://wwwd.caf.fr/wps/myportal/caffr/moncompte/tableaudebord', (e, response, b) => {
    if (response.request.uri.href != 'https://wwwd.caf.fr/wps/myportal/caffr/moncompte/tableaudebord') {
      throw new Error(errors.LOGIN_FAILED)
    }
  })
}

function parseDocuments($) {
  const docs = scrape(
    $,
    {
      title: {
        sel: 'h3 a',
        attr: 'title'
      },
      amount: {
        sel: '.price_color',
        parse: normalizePrice
      },
      fileurl: {
        sel: 'img',
        attr: 'src',
        parse: src => `${baseUrl}/${src}`
      },
      filename: {
        sel: 'h3 a',
        attr: 'title',
        parse: title => `${title}.jpg`
      }
    },
    'article'
  )
  return docs.map(doc => ({
    ...doc,
    // the saveBills function needs a date field
    // even if it is a little artificial here (these are not real bills)
    date: new Date(),
    currency: '€',
    vendor: 'template',
    metadata: {
      // it can be interesting that we add the date of import. This is not mandatory but may be
      // useful for debugging or data migration
      importDate: new Date(),
      // document version, useful for migration after change of document structure
      version: 1
    }
  }))
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

// convert a price string to a float
function normalizePrice(price) {
  return parseFloat(price.replace('£', '').trim())
}
