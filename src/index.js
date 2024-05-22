process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://022abee095bc40ea928c610cf0bdbe8d@errors.cozycloud.cc/21'

// Proxying requests
let CACert = undefined // Role back in normal situation if no secret found
const secrets = JSON.parse(process.env.COZY_PARAMETERS || '{}')?.secret
if (secrets && secrets.proxyUrl) {
  // Env var to define proxy
  process.env.http_proxy = secrets.proxyUrl
  process.env.https_proxy = secrets.proxyUrl
  // Public authority certificate of internal cozy proxy
  CACert = `-----BEGIN CERTIFICATE-----
MIIFozCCA4ugAwIBAgIJAPnnIqmvvTArMA0GCSqGSIb3DQEBBQUAMD8xCzAJBgNV
BAYTAklMMQswCQYDVQQIEwJJTDENMAsGA1UEChMESG9sYTEUMBIGA1UEAxMLbHVt
aW5hdGkuaW8wHhcNMTYwOTI3MTQyODM4WhcNMjYwOTI1MTQyODM4WjA/MQswCQYD
VQQGEwJJTDELMAkGA1UECBMCSUwxDTALBgNVBAoTBEhvbGExFDASBgNVBAMTC2x1
bWluYXRpLmlvMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAtiqw0DuX
g5g7BC+Cr7mZvgXB7CsJ10YFb2xwoDZlHHJ8G0KEMUeNiY9EjPR8ZIHlnjGJehsW
PUvJeSAoDnT+fh4udWyUJ3VSqDTyGpu4DpfLBwaaZP/fq45UeR0oLs3ZJd6joDss
AjJdQbdBPJj/57MjwbF+jddP6qm9XbCWjYzl1uxdMVjloetyRUgkhkh2ALp/VtK8
hUj/XgvD/Y1souKYs5DKayJTn+GM6MlSOUBQ0+b8yUbDb/9vjbHlX4pZ8gbgSEFf
xUV49Sxd6EhRXzFw4TERQVut0cgojmRmrgXXwc4kJi0Uvtc6tV/hJeH2yRS84Ehg
feY5dcJVc69ILYfGrNmwbFvf5aHZPWFG0kIcy9iMMk+3wSUaBP+FAYyd0i+PJTxy
5Jfmhs6BHowuEr0zgL+xge+/RCEbVUPvA6w9DWYbpqckZUh9sPga3JcHjaHGs6Cz
dnjEShgmlBm0DL6JMumLWFJrjztsm56Huuai0F5pwyrsyq8fbK6Sp18sq5/vH3Vy
t2XAj4EIFvpWHZjuocCe5/5vAbkSXjQ5HEIS+SyVhlFriCy5Mf3fTyMFqwm3tbZv
jEooumi0/9F2WvisUgheC1uatZ8M+Pzi+Kp3x2SSS992KWs0M35GEstiB09RkNHe
GItI6qxqY/Npw5u6lBE6Z28ISwvuet1a4vMCAwEAAaOBoTCBnjAdBgNVHQ4EFgQU
Wq7PsMnq2tuDhTV0oUW4jjzvLTcwbwYDVR0jBGgwZoAUWq7PsMnq2tuDhTV0oUW4
jjzvLTehQ6RBMD8xCzAJBgNVBAYTAklMMQswCQYDVQQIEwJJTDENMAsGA1UEChME
SG9sYTEUMBIGA1UEAxMLbHVtaW5hdGkuaW+CCQD55yKpr70wKzAMBgNVHRMEBTAD
AQH/MA0GCSqGSIb3DQEBBQUAA4ICAQA3oT4lrUErSqXjQtDUINo62KcJWs4kjEd8
qXZdl/HVim06nOG6DFZCSh8JngFi4MFmSzGlBGxe1pXaYArtekfLWmhwoVoJiiaA
DAAPItcZNlA9zIORyLZlrXlIuP5xzsb9PbnNWhd9xJHksHGoHDPHAW/KI/GJdjQv
uuCyObvv1IgGvfHbv4lXGCwQuU0OBGXv1kfZtAqUS+ei5zkK+nY0qc3L3Ce+Ow6h
/haDe0FDoT7zkwnEHu/ExCGSR3lNnyBAewlPVMzbJznuPMU3FFA3MHT7IcHxJWff
r8jOXo3qXWqd+T2oDO02KUR2ZVolI8FGx6yIKfLwWnj+eR2dfdMx0tUX4F6mRi4N
zGmhhIIHtViAMf59tBL7az26C8DGfX0p4oECpKtc86u5bYTbRZ1xrf6t/wFqqgB/
RVqn9IhSfXNZtxBn8G0odR8sPIiBxJKvkLMDKoAEeErwd0yqnr8FplskFuPn0FY5
N7n7dj5cHoSUtSAkM6bHCFY+XVtUoy6xisTAobajHvU3e2cDVKizC/ocUbHbTJgh
nevnzyTtKL2w820PDmI7plFN3wR3epd4kTAP5KT196Pjwjg+Dqgt2OnGAafKr+Qr
o2cdIF5MbULVkux4RKzpNKaoDtrnvC1jROM5s1R0Lb96dQcS/VwmyX22lKdbbY9F
ij5GZar9JA==
-----END CERTIFICATE-----
`
}
const randomSessionString = require('crypto').randomBytes(16).toString('hex')

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
  cozyClient,
  solveCaptcha
} = require('cozy-konnector-libs')

// |Mes papiers|
const flag = require('cozy-flags/dist/flag').default

const models = cozyClient.new.models
const { Qualification } = models.document

let requestHTML = requestFactory({
  debug: false,
  cheerio: true,
  json: false,
  jar: true,
  headers: {
    'x-lpm-session': randomSessionString
  },
  ca: CACert
})
let requestJSON = requestFactory({
  debug: false,
  cheerio: false,
  json: true,
  jar: true,
  headers: {
    'x-lpm-session': randomSessionString
  },
  ca: CACert
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
    fileIdAttributes: ['date', 'amount'],
    requestInstance: requestHTML
  })
  // Only one attestation send, replaced each time
  log('warn', `CAF saving ${bills.length} files (attestation)`)
  await this.saveFiles(files, fields, {
    fileIdAttributes: ['filename'],
    requestInstance: requestHTML
  })
  await this.saveIdentity(identity, fields.login)
}

async function authenticate(login, password) {
  if (login == '' || login == null || password == '' || password == null) {
    log('error', 'Some fields are not defined')
    throw new Error(errors.LOGIN_FAILED)
  }
  // Initiate session and test max 3 IP
  await verifyIPAndInitiateSession(3)

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

  let authResp = await requestJSON({
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
  // Checking for force password change
  if (authResp.codeRetour === 106 || authResp.codeRetour === 111) {
    throw new Error('USER_ACTION_NEEDED.CHANGE_PASSWORD')
  }
  // Checking for captcha
  if (authResp.codeRetour === 12 || authResp.captchaIMG?.length) {
    const captchaImage = authResp.captchaIMG
    try {
      const captchaResponse = await solveCaptcha({
        type: 'image',
        captchaImage
      })
      log('info', captchaResponse)
      authResp = await requestJSON({
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
          captcha: captchaResponse,
          contexteAppel: 'caffr'
        }
      })
    } catch (error) {
      log('error', error.message)
      throw new Error(errors.VENDOR_DOWN)
    }
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
  result.contact.email = [getFullProfil.utilisateur.coordonneesContact.mail]
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
  } else if (receivedStatus.match(/célibataire/)) {
    return 'single'
  } else if (receivedStatus.match(/séparée?/)) {
    return 'single'
  } else if (receivedStatus.match(/divorcée?/)) {
    return 'single'
  } else if (receivedStatus.match(/isolée?/)) {
    return 'single'
  } else if (receivedStatus.match(/en reprise de vie maritale/)) {
    // en reprise de vie maritale depuis...
    return 'married'
  } else if (receivedStatus.match(/en reprise de vie commune/)) {
    // en reprise de vie commune avec mon conjoint depuis...
    return 'single'
  } else if (receivedStatus.match(/mariée? depuis le/)) {
    return 'married'
  } else if (receivedStatus.match(/pacsée? depuis le/)) {
    return 'pacs'
  } else {
    log('warn', `The received marital status is not known, ${receivedStatus}`)
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
    if (!number || number === 'A communiquer') {
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

async function verifyIPAndInitiateSession(maxRetry = 3) {
  let retry = maxRetry
  while (retry > 1) {
    try {
      retry = retry - 1
      await Promise.race([
        timeout(10000), // Racing again a 10 sec timeout
        requestHTML(
          requestHTML('https://wwwd.caf.fr', {
            resolveWithFullResponse: true
          })
        )
      ])
      log('warn', 'Caf server is available on this IP')
    } catch (e) {
      if (e.message == 'TIMEOUT') {
        if (retry <= 1) {
          throw new Error('IP_BLOCKED')
        }
        log('warn', 'Rotating IP because this one seems block')
        const newString = require('crypto').randomBytes(16).toString('hex')
        requestHTML = requestFactory({
          debug: false,
          cheerio: true,
          json: false,
          jar: true,
          headers: {
            'x-lpm-session': newString
          },
          ca: CACert
        })
        requestJSON = requestFactory({
          debug: false,
          cheerio: false,
          json: true,
          jar: true,
          headers: {
            'x-lpm-session': newString
          },
          ca: CACert
        })
      } else {
        throw e
      }
    }
  }
}

async function timeout(ms) {
  return new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('TIMEOUT')), ms)
  })
}
