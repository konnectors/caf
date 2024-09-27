import {
  ContentScript,
  RequestInterceptor
} from 'cozy-clisk/dist/contentscript'
import ky from 'ky/umd'
import { blobToBase64 } from 'cozy-clisk/dist/contentscript/utils'
import Minilog from '@cozy/minilog'

const log = Minilog('ContentScript')
Minilog.enable('cafCCC')

const baseUrl = 'https://caf.fr'
const downloadBaseUrl = 'https://wwwd.caf.fr'
const PDF_HEADERS = {
  Accept: 'application/pdf',
  'Content-Type': 'application/pdf'
}
const { lastDayOfMonth } = require('date-fns')

const requestInterceptor = new RequestInterceptor([
  {
    identifier: 'paiements',
    method: 'GET',
    url: '/api/paiementsfront/v1/mon_compte/paiements',
    serialization: 'json'
  },
  // Need both interceptions as infos are needed in both requests
  {
    identifier: 'partialIdentity',
    method: 'GET',
    url: '/api/profilreduitfront/v1/mon_compte/profil_reduit',
    serialization: 'json'
  },
  {
    identifier: 'fullIdentity',
    method: 'GET',
    url: '/api/profilcompletfront/v1/profilcalp',
    serialization: 'json'
  },
  {
    identifier: 'datesNetSocial',
    method: 'GET',
    url: '/api/attestationsfront/v1/mon_compte/dates_net_social',
    serialization: 'json'
  }
])
requestInterceptor.init()

class CafContentScript extends ContentScript {
  async onWorkerReady() {
    await this.waitForElementNoReload('#inputMotDePasse')
    this.watchLoginForm.bind(this)()
  }

  onWorkerEvent({ event, payload }) {
    if (event === 'loginSubmit') {
      this.log('info', `User's credential intercepted`)
      const { login, password } = payload
      // Deleting all spaces here to be sure to have just the 13 needed numbers (avoiding space/blank chars)
      const unspacedLogin = login.replace(/\s+/g, '')
      this.store.userCredentials = { login: unspacedLogin, password }
    }
    if (event === 'requestResponse') {
      const { identifier, response } = payload
      this.log('debug', `${identifier} request intercepted`)
      this.store[identifier] = { response }
      if (identifier === 'paiements' || identifier === 'datesNetSocial') {
        this.store.token = payload.requestHeaders.Authorization
      }
    }
  }

  watchLoginForm() {
    this.log('info', '📍️ watchLoginForm starts')
    const loginField = document.querySelector('#nir')
    const passwordField = document.querySelector('#inputMotDePasse')
    if (loginField && passwordField) {
      this.log('info', 'Found credentials fields, adding form listener')
      const loginForm = document.querySelector('form')
      loginForm.addEventListener('submit', () => {
        const login = loginField.value
        const password = passwordField.value
        const event = 'loginSubmit'
        const payload = { login, password }
        this.bridge.emit('workerEvent', {
          event,
          payload
        })
      })
    }
  }

  async ensureAuthenticated({ account }) {
    this.bridge.addEventListener('workerEvent', this.onWorkerEvent.bind(this))
    this.log('info', '🤖 ensureAuthenticated')
    if (!account) {
      await this.ensureNotAuthenticated()
    }
    if (!(await this.isElementInWorker('#inputMotDePasse'))) {
      await this.navigateToLoginForm()
    }
    const authenticated = await this.runInWorker('checkAuthenticated')
    if (!authenticated) {
      const credentials = await this.getCredentials()
      if (credentials) {
        this.log('info', 'Credentials found, trying autoFill ...')
        await this.autoFill(credentials)
      }
      this.log('info', 'Waiting for user to complete login')
      await this.showLoginFormAndWaitForAuthentication()
    }
    this.unblockWorkerInteractions()
    return true
  }

  async ensureNotAuthenticated() {
    this.log('info', '🤖 ensureNotAuthenticated')
    await this.navigateToLoginForm()
    const authenticated = await this.runInWorker('checkAuthenticated')
    if (!authenticated) {
      return true
    }
  }

  async navigateToLoginForm() {
    this.log('info', '🤖 navigateToLoginForm')
    await this.gotoAndCheckCaptcha(
      baseUrl,
      '.is-disconnected > a[href="/redirect/s/Redirect?page=monCompte"]'
    )
    await this.clickAndWait(
      '.is-disconnected > a[href="/redirect/s/Redirect?page=monCompte"]',
      '#inputMotDePasse'
    )
  }

  async gotoAndCheckCaptcha(url, awaitedElement) {
    this.log('info', '📍️ gotoAndCheckCaptcha starts')
    await this.goto(url)
    await Promise.race([
      this.waitForElementInWorker(awaitedElement),
      this.waitForElementInWorker('h1', {
        includesText: 'Nous nous excusons pour le désagrément...'
      })
    ])
    if (await this.runInWorker('checkCaptcha')) {
      this.log('info', 'Captcha found, waiting for user action')
      await this.showCaptchaFormAndWaitForUserAction(awaitedElement)
    }
  }

  async checkAuthenticated() {
    // Some login may lead directly to the userInfos page for inactive accounts
    if (document.querySelector('cnaf-cds-profilcomplet-profil-primo')) {
      await this.sendToPilot({ isInactive: true })
      return true
    }
    return Boolean(document.querySelector('#paiements-droits-collapse'))
  }

  async showLoginFormAndWaitForAuthentication() {
    log.debug('showLoginFormAndWaitForAuthentication start')
    await this.setWorkerState({ visible: true })
    await this.runInWorkerUntilTrue({
      method: 'waitForAuthenticated'
    })
    await this.setWorkerState({ visible: false })
  }

  async showCaptchaFormAndWaitForUserAction(element) {
    log.debug('showCaptchaFormAndWaitForUserAction start')
    await this.setWorkerState({ visible: true })
    await this.waitForElementInWorker(element)
    await this.setWorkerState({ visible: false })
  }

  async autoFill(credentials) {
    this.log('info', '📍️ autoFill starts')
    const nirSelector = '#nir'
    const passwordSelector = '#inputMotDePasse'
    await this.waitForElementInWorker(nirSelector)
    await this.runInWorker('fillText', nirSelector, credentials.login)
    await this.runInWorker('fillText', passwordSelector, credentials.password)
  }

  async getUserDataFromWebsite() {
    this.log('info', '🤖 getUserDataFromWebsite')
    const credentials = await this.getCredentials()
    const credentialsLogin = credentials?.login
    const storeLogin = this.store?.userCredentials?.login

    // prefer credentials over user email since it may not be know by the user
    let sourceAccountIdentifier = credentialsLogin || storeLogin
    if (!sourceAccountIdentifier) {
      throw new Error('Could not get a sourceAccountIdentifier')
    }
    return {
      sourceAccountIdentifier: sourceAccountIdentifier
    }
  }

  async fetch(context) {
    this.log('info', '🤖 fetch')
    if (this.store.userCredentials) {
      await this.saveCredentials(this.store.userCredentials)
    }
    if (!this.store.isInactive) {
      const userCnafId = await this.evaluateInWorker(() => {
        return document.documentElement.innerHTML.match(
          /var userid = "([0-9-]*)";/
        )[1]
      })
      this.store.cnafUserId = userCnafId.split('-')[1]
      const bills = await this.fetchPaiements()
      if (bills.length) {
        await this.saveBills(bills, {
          context,
          fileIdAttributes: ['date', 'amount'],
          contentType: 'application/pdf',
          qualificationLabel: 'payment_proof_family_allowance'
        })
      }
      const attestations = await this.fetchAttestations()
      if (attestations.length) {
        await this.saveFiles(attestations, {
          context,
          fileIdAttributes: ['filename'],
          contentType: 'application/pdf',
          qualificationLabel: 'caf'
        })
      }
    } else {
      this.log(
        'warn',
        'Looks like it is an inactive account, fetching partial identity only ...'
      )
    }
    const identity = await this.fetchIdentity()
    await this.saveIdentity(identity)
  }

  async fetchPaiements() {
    this.log('info', '📍️ fetchPaiements starts')
    await this.gotoAndCheckCaptcha(
      'https://wwwd.caf.fr/redirect/s/Redirect?page=monCompteMesPaiements',
      '#paiements-droits-complet-collapse'
    )
    const hasNoPaiements = await this.evaluateInWorker(() => {
      return document
        .querySelector('#paiements-droits-complet-collapse > div')
        .textContent.includes(
          "Il n'y a pas de paiement effectué sur votre compte."
        )
    })
    if (hasNoPaiements) {
      this.log('warn', 'Accounts seems to have no payments')
      return []
    }
    const interceptedBills = this.store.paiements.response.paiements
    const bills = await this.computeBills(interceptedBills)
    return bills
  }

  async computeBills(docs) {
    this.log('info', '📍️ computeBills starts')
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
        vendor: 'caf',
        fileurl: `${downloadBaseUrl}/api/attestationsfront/v1/mon_compte/attestation_sur_periode/paiements/${yearElab}${monthElab}01/${yearElab}${monthElab}${lastDayElab}`,
        filename: `${formatShortDate(
          dateElab
        )}_caf_attestation_paiement_${amount.toFixed(2)}€.pdf`,
        fileAttributes: {
          metadata: {
            contentAuthor: 'caf.fr',
            number: this.store.cnafUserId,
            issueDate: new Date(),
            datetimeLabel: 'issuDate',
            isSubscription: false,
            carbonCopy: true
          }
        },
        requestOptions: {
          headers: {
            Authorization: this.store.token,
            ...PDF_HEADERS
          }
        }
      }

      // In the CCS version of this konnector, we used to need to migrate the cafFileNumber metadata
      // This is supposed to be done now, but while confirming with the other teams we keep this around
      // |Mes papiers|
      // this.client = CozyClient.fromEnv()
      // await this.client.registerPlugin(flag.plugin)
      // await this.client.plugins.flags.initializing
      // if (flag('mespapiers.migrated.metadata')) {
      //   oneBill.fileAttributes.metadata.number = cafFileNumber
      // } else {
      //   oneBill.fileAttributes.metadata.cafFileNumber = cafFileNumber
      // }
      // =====
      bills.push(oneBill)
    }
    return bills
  }

  async fetchAttestations() {
    this.log('info', '📍️ fetchAttestations starts')
    await this.gotoAndCheckCaptcha(
      'https://wwwd.caf.fr/redirect/s/Redirect?page=monCompteAttestationPaiement',
      '.label-form-cnaf'
    )
    const attestations = await this.computeAttestations()
    return attestations
  }

  async computeAttestations() {
    this.log('info', '📍️ computeAttestations starts')
    const attestationPaiement = {
      shouldReplaceFile: () => true,
      fileurl: `${downloadBaseUrl}/api/attestationsfront/v1/mon_compte/derniere_attestation/paiements`,
      filename: `caf_attestation_paiements.pdf`,
      fileAttributes: {
        metadata: {
          contentAuthor: 'caf.fr',
          number: this.store.cnafUserId,
          issueDate: new Date(),
          datetimeLabel: 'issuDate',
          isSubscription: false,
          carbonCopy: true
        }
      }
    }
    const attestationMontantNetSocial = {
      ...attestationPaiement,
      fileurl: `${downloadBaseUrl}/api/attestationsfront/v1/mon_compte/derniere_attestation/mns`,
      filename: `caf_attestation_montant_net_social.pdf`
    }
    const attestationQuotientFamilial = {
      ...attestationPaiement,
      fileurl: `${downloadBaseUrl}/api/attestationsfront/v1/mon_compte/derniere_attestation/qf`,
      filename: `caf_attestation_quotient_familial.pdf`
    }
    const allAttestations = [
      attestationPaiement,
      attestationMontantNetSocial,
      attestationQuotientFamilial
    ]
    const availableAttestations = []
    for (const attestation of allAttestations) {
      const dataUri = await this.runInWorker('getFileDataUri', {
        token: this.store.token,
        url: attestation.fileurl
      })
      if (!dataUri) {
        this.log(
          'warn',
          `User have no ${attestation.filename} file to download.`
        )
        continue
      } else {
        const oneAttestation = {
          ...attestation,
          dataUri
        }
        delete oneAttestation.fileurl
        availableAttestations.push(oneAttestation)
      }
    }
    // In the CCS version of this konnector, we used to need to migrate the cafFileNumber metadata
    // This is supposed to be done now, but while confirming with the other teams we keep this around
    // |Mes papiers|
    // if (flag('mespapiers.migrated.metadata')) {
    //   attestation.fileAttributes.metadata.number = cafFileNumber
    // } else {
    //   attestation.fileAttributes.metadata.cafFileNumber = cafFileNumber
    // }
    // =====
    return availableAttestations
  }

  async fetchIdentity() {
    this.log('info', '📍️ fetchIdentity starts')
    if (!this.store.isInactive) {
      await this.gotoAndCheckCaptcha(
        'https://wwwd.caf.fr/redirect/s/Redirect?page=monCompte',
        '#paiements-droits-collapse'
      )
      await this.gotoAndCheckCaptcha(
        'https://wwwd.caf.fr/redirect/s/Redirect?page=monCompteMonProfil',
        'cnaf-cds-profilcomplet-allocataire'
      )
    }
    const identity = await this.computeIdentity()
    return identity
  }

  async computeIdentity() {
    this.log('info', '📍️ computeIdentity starts')
    const fullProfil = this.store.fullIdentity?.response
    const partialProfil = this.store.partialIdentity?.response
    const result = { contact: {} }

    const maritalStatus = fullProfil.sitfam?.libSitFam
    const numberOfDependants = partialProfil
    const address = fullProfil.adresse
    const email = fullProfil.utilisateur?.coordonneesContact?.mail
    const userCoordinates = fullProfil.utilisateur?.coordonneesContact
    const gender = fullProfil.utilisateur?.civ
    const cafFileNumber = this.store.cnafUserId

    if (maritalStatus) {
      result.contact.maritalStatus = findMaritalStatus(maritalStatus)
    }
    if (numberOfDependants) {
      result.contact.numberOfDependants =
        findNumberOfDependants(numberOfDependants)
    }
    if (address) {
      result.contact.address = findAddressInfos(address)
    }
    if (email) {
      result.contact.email = [email]
    }
    if (userCoordinates) {
      result.contact.phone = findPhoneNumbers(userCoordinates)
    }
    if (gender) {
      result.contact.gender = computeGender(gender)
    }
    if (cafFileNumber) {
      result.cafFileNumber = cafFileNumber
    }
    return result
  }

  checkCaptcha() {
    this.log('info', '📍️ checkCaptcha starts')
    if (document.location.href.includes('https://validate.perfdrive.com/')) {
      return true
    }
    return false
  }

  async getFileDataUri({ token, url }) {
    this.log('info', '📍️ getFileDataUri starts')
    const response = await ky.get(url, {
      headers: {
        Authorization: token
      }
    })
    const clonedResponse = await response.clone()
    if (!clonedResponse.ok) {
      if (clonedResponse.status === 409) {
        const errorHeader = clonedResponse.headers.get('libelleerreurcaffr')
        this.log(
          'info',
          `File fetching result in 409 error with following message : ${errorHeader}`
        )
        return null
      } else if (clonedResponse.status === 403) {
        this.log(
          'info',
          `File fetching result in 403, user is not authorized to access this ressource`
        )
        throw new Error(
          'File fetching results in 403, check the code, token should be found in interceptions'
        )
      } else if (clonedResponse.status === 404) {
        this.log('info', `File fetching result in 404, given url is not found`)
        throw new Error(
          'File fetching results in 404, check the downloads urls'
        )
      } else if (
        clonedResponse.status === 500 ||
        clonedResponse.status === 502 ||
        clonedResponse.status === 503
      ) {
        throw new Error('VENDOR_DOWN')
      } else {
        throw new Error(
          `File fetching leads to untreated ${clonedResponse.status} error`
        )
      }
    }
    const blob = await response.blob()
    const dataUri = await blobToBase64(blob)
    return dataUri
  }
}

const connector = new CafContentScript({ requestInterceptor })
connector
  .init({ additionalExposedMethodsNames: ['checkCaptcha', 'getFileDataUri'] })
  .catch(err => {
    log.warn(err)
  })

// Convert a date from format Ymmdd  to Date object
function parseDate(text) {
  const y = text.substr(0, 4)
  const m = parseInt(text.substr(4, 2), 10)
  const d = parseInt(text.substr(6, 2), 10)
  return new Date(y, m - 1, d)
}

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

// Convert a Date object to a ISO date string
function formatShortDate(date) {
  let year = date.getFullYear()
  let month = date.getMonth() + 1
  if (month < 10) {
    month = '0' + month
  }
  return `${year}-${month}`
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
