process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://022abee095bc40ea928c610cf0bdbe8d@errors.cozycloud.cc/21'

// This has been added for "Mes papiers" needs
// It must be removed when everything has been sat up and synchronized
// When it will be removed, we will only keep 'number' instead of 'cafFileNumber'
const { default: CozyClient } = require('cozy-client')

const {
  BaseKonnector,
  requestFactory,
  errors,
  log,
  utils,
  cozyClient
} = require('cozy-konnector-libs')

// |Mes papiers|
const flag = require('cozy-flags/dist/flag').default

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
let cnafUserId
const lastDayOfMonth = require('date-fns').lastDayOfMonth
const subMonths = require('date-fns').subMonths

module.exports = new BaseKonnector(start)

async function start(fields) {
  await this.deactivateAutoSuccessfulLogin()
  fields.login = normalizeLogin(fields.login)
  log('info', 'Authenticating ...')
  let LtpaToken2
  try {
    LtpaToken2 = await authenticate.bind(this)(fields.login, fields.password)
  } catch (e) {
    if (
      e.message === 'LOGIN_FAILED' ||
      e.message.includes('CGU_FORM') ||
      e.message.includes('USER_ACTION_NEEDED')
    ) {
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

  const identity = await fetchIdentity(cnafToken)
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
  const bills = await parseDocuments(paiements, token, identity.cafFileNumber)

  log('info', 'Parsing attestation')
  const files = await parseAttestation(token, identity.cafFileNumber)

  log('info', 'Saving data to Cozy')
  log('warn', `CAF saving ${bills.length} bills`)
  await this.saveBills(bills, fields, {
    contentType: 'application/pdf',
    linkBankOperations: false,
    fileIdAttributes: ['date', 'amount']
  })
  // Only one attestation send, replaced each time
  log('warn', `CAF saving ${bills.length} files (attestation)`)
  await this.saveFiles(files, fields, {
    fileIdAttributes: ['filename']
  })
  await this.saveIdentity(identity, fields.login)
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

  // Checking for auth
  for (const etape of authResp.etapesConnexion) {
    if (etape.nom === 'CGU' && etape.obligatoire === true) {
      throw new Error('USER_ACTION_NEEDED.CGU_FORM')
    }
  }
  if (authResp.codeRetour === 106) {
    throw new Error('USER_ACTION_NEEDED.CHANGE_PASSWORD')
  }
  if (authResp.codeRetour != 0) {
    log(
      'warn',
      `Auth return a non 0 code, code : ${authResp.codeRetour}, not nominal`
    )
  }

  // Get LtpaToken2 with ccode
  let LtpaToken2 = await requestHTML(
    `https://wwwd.caf.fr/wpc-connexionportail-web/s/AccesPortail?urlredirect=/wps/myportal/caffr/moncompte/tableaudebord&ccode=${authResp.ccode}`,
    {
      resolveWithFullResponse: true
    }
  )
  // When not logged completly, cnafID is not yet in the html
  try {
    cnafUserId = LtpaToken2.body.html().match(/var userid = "([0-9-]*)";/)[1]
  } catch (e) {
    log('warn', 'Impossible to evalutate cnafUserId, continuing')
  }

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

async function parseDocuments(docs, token, cafFileNumber) {
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
    const oneBill = {
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
          // number: cafFileNumber,
          issueDate: utils.formatDate(new Date()),
          datetimeLabel: 'issuDate',
          isSubscription: false,
          carbonCopy: true,
          qualification: Qualification.getByLabel(
            'payment_proof_family_allowance'
          )
        }
      }
    }
    // |Mes papiers|
    this.client = CozyClient.fromEnv()
    await this.client.registerPlugin(flag.plugin)
    await this.client.plugins.flags.initializing
    if (flag('mespapiers.migrated.metadata')) {
      oneBill.fileAttributes.metadata.number = cafFileNumber
    } else {
      oneBill.fileAttributes.metadata.cafFileNumber = cafFileNumber
    }
    // =====
    bills.push(oneBill)
  }
  return bills
}

async function parseAttestation(token, cafFileNumber) {
  await requestHTML(`${baseUrl}/wps/myportal/caffr/moncompte/mesattestations`, {
    resolveWithFullResponse: true
  })
  const today = Date.now()
  const lastMonth = subMonths(today, 1)
  const [year, month] = dateToYearMonth(lastMonth)
  const lastDay = daysInMonth(month, year)
  const attestation = {
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
        // number: cafFileNumber,
        issueDate: utils.formatDate(new Date()),
        datetimeLabel: 'issuDate',
        isSubscription: false,
        carbonCopy: true,
        qualification: Qualification.getByLabel('caf')
      }
    }
  }
  // |Mes papiers|
  if (flag('mespapiers.migrated.metadata')) {
    attestation.fileAttributes.metadata.number = cafFileNumber
  } else {
    attestation.fileAttributes.metadata.cafFileNumber = cafFileNumber
  }
  // =====

  // A array with one element
  return [attestation]
}

async function fetchIdentity(token) {
  // We need both request, as the numberOfDependants value is not present in the first response
  const getFullProfil = await requestJSON(
    `${baseUrl}/api/profilcompletfront/v1/profilcalp`,
    {
      headers: {
        Authorization: token
      },
      method: 'GET'
    }
  )
  let getPartialProfil
  try {
    getPartialProfil = await requestJSON(
      `${baseUrl}/api/profilreduitfront/v1/mon_compte/profil_reduit`,
      {
        headers: {
          Authorization: token
        },
        method: 'GET'
      }
    )
  } catch (e) {
    log('warn', e)
    log(
      'warn',
      'Impossible to fetch identity but logged, old account, exiting nicely'
    )
    process.exit(0)
  }

  const result = { contact: {} }

  result.contact.maritalStatus = findMaritalStatus(
    getFullProfil.sitfam.libSitFam
  )
  result.contact.numberOfDependants = findNumberOfDependants(getPartialProfil)
  result.contact.address = findAddressInfos(getFullProfil.adresse)
  result.contact.email = getFullProfil.utilisateur.coordonneesContact.mail
  result.contact.phone = findPhoneNumbers(
    getFullProfil.utilisateur.coordonneesContact
  )
  result.contact.gender = computeGender(getFullProfil.utilisateur.civ)
  result.cafFileNumber = cnafUserId.split('-')[1]

  return result
}

function findMaritalStatus(receivedStatus) {
  // We don't dispose of every status for the moment, it will be filled up by the time
  if (receivedStatus.match(/concubinage/)) {
    return 'single'
  }
  if (receivedStatus.match(/séparée?/)) {
    return 'single'
  }
  if (receivedStatus.match(/mariée? depuis le/)) {
    return 'married'
  }
  if (receivedStatus.match(/pacsée? depuis le/)) {
    return 'pacs'
  } else {
    log('warn', 'The received marital status is not known')
    return undefined
  }
}

function findNumberOfDependants(profil) {
  let numberOfDependants = 0
  if (profil.libEnfants === '') {
    return numberOfDependants
  } else {
    numberOfDependants = profil.libEnfants.match(
      /J'ai ([0-9]{1,2}) enfants?./
    )[1]
  }

  return numberOfDependants
}

function findAddressInfos(profil) {
  let foundAddress = ''
  if (profil.complementAdresse2 != '') {
    foundAddress = `${profil.complementAdresse2} `
  }
  if (profil.complementAdresse1 != '') {
    foundAddress = `${foundAddress}${profil.complementAdresse1} `
  }
  if (profil.nomVoie != '') {
    foundAddress = `${foundAddress}${profil.nomVoie} `
  }
  if (profil.commune != '') {
    foundAddress = `${foundAddress}${profil.commune} `
  }
  if (profil.pays != '') {
    foundAddress = `${foundAddress}${profil.pays} `
  }
  const postcode = profil.commune.substring(0, profil.commune.indexOf(' '))
  const city = profil.commune.substring(profil.commune.indexOf(' ') + 1)
  return [
    {
      formattedAddress: foundAddress,
      street: profil.nomVoie,
      postcode,
      city
    }
  ]
}

function findPhoneNumbers(receivedCoordinates) {
  let phone = []
  const foundNumbers = [
    receivedCoordinates.numTel1,
    receivedCoordinates.numTel2
  ]
  for (const number of foundNumbers) {
    if (number === 'A communiquer') {
      continue
    }
    const isMobile = ['06', '07', '+336', '+337'].some(digit =>
      number.startsWith(digit)
    )
    phone.push({
      type: isMobile ? 'mobile' : 'home',
      number
    })
  }
  return phone
}

function computeGender(civility) {
  if (civility === 'MME') {
    return 'F'
  } else if (civility === 'MR') {
    return 'M'
  } else {
    log('warn', "Gender not recognize, returning 'Unknow'")
    return 'U'
  }
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
  log('debug', 'normalizeLogin start')
  if (login && login.length > 13) {
    log('info', 'Had to normalize login length to 13 chars')
    const normalizedLogin = login.replace(/\s/g, '').slice(0, 13)
    return normalizedLogin
  }
  if (login && login.length < 13) {
    log('error', 'Login length is under 13 characters')
    throw new Error(errors.LOGIN_FAILED)
  }

  return login
}
