import { ContentScript } from 'cozy-clisk/dist/contentscript'
import Minilog from '@cozy/minilog'
const log = Minilog('ContentScript')
Minilog.enable('cafCCC')

const baseUrl = 'https://caf.fr'

class CafContentScript extends ContentScript {
  async navigateToLoginForm() {
    this.log('info', '🤖 navigateToLoginForm')
    await this.goto(baseUrl)
    await this.waitForElementInWorker('.is-disconnected > a[href="/redirect/s/Redirect?page=monCompte"]')
    await this.runInWorker('click', '.is-disconnected > a[href="/redirect/s/Redirect?page=monCompte"]')
    await this.waitForElementInWorker('#inputMotDePasse')
  }

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
      this.log('info', `{login, password} : ${JSON.stringify({unspacedLogin, password})}`)
      this.store.userCredentials = { login: unspacedLogin, password }
    }
    // if (event === 'requestResponse') {
    //   if (payload.identifier === 'userIdentity')
    //     this.log('info', `request intercepted`)
    //   const { response } = payload
    //   this.store.interceptedIdentity = { response }
    // }
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
    if (!await this.isElementInWorker('#inputMotDePasse')){
      await this.navigateToLoginForm()
    }
    const authenticated = await this.runInWorker('checkAuthenticated')
    if (!authenticated) {
      this.log('info', 'Not authenticated')
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

  async checkAuthenticated() {
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
    this.log('info', `sourceAccountIdentifier : ${JSON.stringify(sourceAccountIdentifier)}`)
    await this.waitForElementInWorker('[pause]')
    return {
      sourceAccountIdentifier: sourceAccountIdentifier
    }
  }
  async fetch(context) {
    this.log('info', '🤖 fetch')
    await this.goto('https://books.toscrape.com')
    await this.waitForElementInWorker('#promotions')
    const bills = await this.runInWorker('parseBills')

    await this.saveBills(bills, {
      contentType: 'image/jpeg',
      fileIdAttributes: ['filename'],
      context
    })

    const identity = await this.runInWorker('parseIdentity')
    await this.saveIdentity(identity)
  }

  
}

const connector = new CafContentScript()
connector
  .init({ additionalExposedMethodsNames: [] })
  .catch(err => {
    log.warn(err)
  })
