const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // this allows request-promise to keep cookies between requests
  jar: true
})

const baseUrl = 'https://wwwd.caf.fr'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.num, fields.zipcode, fields.born, fields.password)
  log('info', 'Successfully logged in')
  /*   // The BaseKonnector instance expects a Promise as return of the function
    log('info', 'Fetching the list of documents')
    const $ = await request(`${baseUrl}/index.html`)
    // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
    log('info', 'Parsing list of documents')
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

  //TODO: Il y a surement d'autres requetes à faire avant pour récupérer certains cookies ou autres nécessaires pour les requetes suivantes

  // Par exemple : soit cette requete est inutile, soit elle permet de récupérer des cookies ou autres nécessaires aux requetes ci-dessous
  /* const post = await request({
     url: `${baseUrl}/api/loginfront/v1/mon_compte/identifier`,
     method: 'post',
     headers: {*/
  // 'Accept': 'application/json, text/plain, */*',
  /* 'Accept-Language': 'en-US,en;q=0.9',
   'Content-Type': 'application/json;charset=UTF-8',
   'Host': 'wwwd.caf.fr',
   'Origin': 'https://wwwd.caf.fr',
   'Referer': 'https://wwwd.caf.fr/wps/portal/caffr/login/!ut/p/a1/<refererToken>/', //TODO: Récupérer le referer token
   'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36',
   'Connection': 'keep-alive',
   'Cache-Control': 'no-cache',
   'Cookie': '', //TODO: On a peut-etre besoin de cookies
   'Authorization': token,
 },
 form: {
   codeOrga: '351', //TODO: à recupérer en Json avant grace un GET https://wwwd.caf.fr/api/loginfront/v1/mon_compte/communes/${zipcode}
   numeroAllocataire: num,
   codePostal: zipcode,
   jourMoisNaissance: born
 }
}, (error, response, body) => {
})*/

  // On demande une autorisation :
  let token
  await request({
    url: 'https://wwwd.caf.fr/wps/s/GenerateTokenJwtPublic/'
  }, (error, response, body) => {
    token = JSON.parse(body).cnafTokenJwt
  })

  // On récupère le codeOrga : 
  let codeOrga
  await request({
    url: `https://wwwd.caf.fr/api/loginfront/v1/mon_compte/communes/${zipcode}`,
    headers: {
      'Authorization': token
    }
  }, (error, response, body) => {
    codeOrga = JSON.parse(body).listeCommunes[0].codeOrga
  })

  //  On récupère le referer avec son token :
  // curl 'http://www.caf.fr/redirect/redirect.php?page=monCompte' - H 'Connection: keep-alive' - H 'Pragma: no-cache' - H 'Cache-Control: no-cache' - H 'Upgrade-Insecure-Requests: 1' - H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36' - H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8' - H 'Referer: http://www.caf.fr/' - H 'Accept-Encoding: gzip, deflate' - H 'Accept-Language: en-US,en;q=0.9' - H 'Cookie: DYN_PERSYS=1025157312.14119.0000; rxVisitor=1548839522932T4KPS2JV09NQ3EML74SE85L5AH0UGV4Q; modeAffichage=web; ace_sticky_slb=R3595672858; atuserid=%7B%22name%22%3A%22atuserid%22%2C%22val%22%3A%22c5bf00a4-604e-4ebe-a96b-300aca8237fa%22%2C%22options%22%3A%7B%22end%22%3A%222020-03-02T09%3A12%3A04.351Z%22%2C%22path%22%3A%22%2F%22%7D%7D; atidvisitor=%7B%22name%22%3A%22atidvisitor%22%2C%22val%22%3A%7B%22vrn%22%3A%22-516084-%22%7D%2C%22options%22%3A%7B%22path%22%3A%22%2F%22%2C%22session%22%3A15724800%2C%22end%22%3A15724800%7D%7D; session_caf=351; cookie-agreed=2; JSESSIONID=00006oAFbG8cOosPre9xl8ADq33:18ntpvh74; TS01dec71a=015e43680bd21b8432ad9c349cbe34e8432dfbf0ebe478226c5a97be957d2fd5a09321af6b327e511eeceb8c1fe875f450c9685216925a803472eb500eadd2db4f101b021b; has_js=1; redirect=accueilCaffr; TS01cc9cc2=015e43680b292ed974b2fba74ff775b596ebf3ad47e478226c5a97be957d2fd5a09321af6b49cae8ff5e637d4baa925417b07ce0c3907c59dd32ddddc0982dcddcdc4923f8ddfc1c4c834238ff92f54f281e30aef9a8ec560e35296a6ed42c4b827ccb79b9304a945a823253a2830e67392faaa66c; dtPC=13$242007264_138h-vHMGULPTLOGNGPPHFPMKANIDJKTNIBVVP; rxvt=1548843816075|1548839522939; dtLatC=1; dtSa=true%7CC%7C-1%7Cheader-monc-notif%20icon-pic-notification%7C-%7C1548842045829%7C242007264_138%7Chttp%3A%2F%2Fwww.caf.fr%2F%7CBienvenue%20sur%20Caf.fr%20%5Ep%20caf.fr%7C1548842016076%7C; dtCookie=13$692D3DBFD4457F2174A98B10ACDE5EED|RUM+Default+Application|1' --compressed
  // Ou
  let referer
  await request({
    url: 'https://wwwd.caf.fr/wps/redirect',
    headers: {
      'Cookie': 'WASReqURL=https://wwwd.caf.fr/wps/myportal/caffr/moncompte/tableaudebord; TS0163ef20=015e43680bc8504acecfb29d61fee7f355c2a72db905778274d9e81b8875c3f364ad21a17a6892ce639c937eba672bf048619b9c44d76e25dfad91f28d18811d74d1a87a141b5ff043cfbeb4f07e134d8e1649e2ff30edc1427a7208891449cddedecaf436'
    }
  }, (e, r, b) => {
    referer = `https://wwwd.caf.fr${r.headers['content-location']}`
  })

  //TODO: Puis il faut parser le numpad, et trouver le moyen de récupérer le password parsé à passer en formData à cette requete                                                                                                                                                      

  //TODO: On peut ensuite s'authentifier avec num, zipcode, born et password    
  // curl 'https://wwwd.caf.fr/wta-portletangular-web/s/authentifier_mdp' -H 'Accept: application/json, text/plain, */*' -H 'Referer: https://wwwd.caf.fr/wps/portal/caffr/login/!ut/p/a1/<RefererToken>' -H 'Origin: https://wwwd.caf.fr' -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8;' --data 'codeOrga=<codeOrga>&jourMoisNaissance=<born>&matricule=<num>&positions=<parsedPassword>&typeCanal=1' --compressed

  // Il est possible qu'il faille ensuite récupérer une authorization :
  await request({
    url: 'https://wwwd.caf.fr/wps/s/GenerateTokenJwtPublic/'
  }, (error, response, body) => {
    token = JSON.parse(body).cnafTokenJwt
  })

  //TODO: Ensuite il y a peut-etre d'autres requetes à faire pour obtenir la page
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

// convert a price string to a float
function normalizePrice(price) {
  return parseFloat(price.replace('£', '').trim())
}
