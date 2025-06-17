const https = require('https')
const { argv } = require('yargs')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const AWS = require('aws-sdk')
const mime = require('mime')
const chalk = require('chalk')
require('dotenv').config()

const CrawConsoleUtils = require('./utils/craw-console')

let s3

/** Declare NocoDB */
if (argv.json) {
  const projectJson = JSON.parse(fs.readFileSync(`./projects/${argv.json}`, 'utf8'))
  if (!projectJson.NOCO_PROJECT_ID) {
    throw new Error('Invalid json file')
  }
  argv.nocodbToken = process.env.NOCO_DB_TOKEN
  argv.nocodbProjectId = projectJson.NOCO_PROJECT_ID
  argv.projectKey = projectJson.PROJECT_KEY
  argv.siteEnv = projectJson.SITE_ENV

  const credentials = new AWS.SharedIniFileCredentials({ profile: 'Key-Tool-Check-Console' })
  AWS.config.credentials = credentials
  s3 = new AWS.S3()
}

const {
  projectKey, nocodbProjectId, nocodbToken, siteEnv
} = argv
const prefixDomain = 'https://nocodb.box.gravity.codes/api/v1/db/data/noco/'
const axiosApi = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  }),
  baseURL: prefixDomain + nocodbProjectId.trim(),
  headers: {
    'xc-token': nocodbToken.trim()
  }
})

const getSiteBaseUrl = async () => {
  const { data } = await axiosApi.get('/Sitedeclaration')
  if (Array.isArray(data.list) && data.list.length) {
    const siteInfo = siteEnv && typeof siteEnv === 'string' ? data.list.find((item) => String(item.Env).toLowerCase() === siteEnv.toLowerCase()) : data.list[0]
    if (!siteInfo) {
      throw new Error('Invalid site enviroment')
    }
    return siteInfo.BaseURL
  }
  throw new Error('Base URL not found')
}

const getPagesDeclarations = async () => {
  const siteBaseUrl = await getSiteBaseUrl()
  const limit = 100
  const respCount = await axiosApi.get('Pagesdeclarations/count')
  const pages = []
  for (let i = 0; i < Math.ceil(respCount.data.count / limit); i += 1) {
    const { data } = await axiosApi.get('Pagesdeclarations', {
      params: {
        limit,
        offset: i * limit
      }
    })
    pages.push(...data.list)
  }
  return pages.reduce((urls, page) => {
    if (['Yes', 'yes', 'Y', 'y'].includes(page.CheckConsole)) {
      urls.push(siteBaseUrl + page.URL)
    }
    return urls
  }, [])
}
/** Declare NocoDB */

// eslint-disable-next-line no-promise-executor-return
const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const try2pass = async (fn) => {
  let maxCount = 5
  while (maxCount) {
    maxCount -= 1
    try {
      return await fn()
    } catch (error) {
      if (!maxCount) {
        throw error
      }
    }
  }
  return false
}

const uploadDir2S3 = async (localDirPath, bucketName, bucketPath) => {
  function walkSync(currentDirPath, callback) {
    fs.readdirSync(currentDirPath).forEach((name) => {
      const filePath = path.join(currentDirPath, name)
      const stat = fs.statSync(filePath)
      if (stat.isFile()) {
        callback(filePath, stat)
      } else if (stat.isDirectory()) {
        walkSync(filePath, callback)
      }
    })
  }

  walkSync(localDirPath, (filePath) => {
    const s3Key = `${bucketPath}/${filePath.replace(/^.+?[\\|/]/gm, '').replace(/\\/g, '/')}`
    const params = {
      Bucket: bucketName,
      Key: s3Key,
      CacheControl: 'no-cache',
      ContentType: mime.getType(s3Key),
      Body: fs.readFileSync(filePath)
    }
    s3.putObject(params, (err) => {
      if (err) {
        console.log(err)
      }
    })
  })
}

async function main() {
  const buildNumber = argv.json ? new Date().getTime() : argv.buildNum
  console.log(`Tool run with Build Num: ${chalk.yellow(buildNumber)} in ${chalk.yellow(argv.json ? 'local' : 'jenkins')} mode`)

  const urls = await getPagesDeclarations()

  const browserConsoles = {}
  const browsers = {}
  for (const [i, url] of urls.entries()) {
    console.log(chalk.green(`[${i + 1}/${urls.length}][check-console]: ${url}`))
    try {
      const { consoles, versions } = await try2pass(
        () => CrawConsoleUtils.crawConsoleALLBrowser({ url })
      )
      browserConsoles[url] = consoles
      browsers[url] = versions
      await timeout(3000)
    } catch (error) {
      browserConsoles[url] = {
        errorMessage: `[ERROR]: ${error && error.message}`,
        status: 'Error',
        statusCode: 400
      }
      browsers[url] = {}
      console.log(chalk.red(`Error: ${error && error.message}`))
    }
  }

  console.log('creating json')
  const json = JSON.stringify({
    projectName: projectKey,
    buildNumber,
    browsers,
    'items-object': browserConsoles
  })
  console.log('creating project.json file')
  await fs.promises.writeFile('./report/project.json', json)
  if (argv.json) {
    const projectPath = siteEnv && typeof siteEnv === 'string' ? `${projectKey}/${siteEnv}` : `${projectKey}`
    const s3BaseUrl = `master-report/${projectPath}/check-console/local/${buildNumber}`
    await uploadDir2S3('./report', '9w-internal-master-report', s3BaseUrl)
    console.log(`\nReport URL: ${chalk.cyan(`https://master-report.tools.gravityapps.net/${s3BaseUrl}/index.html`)}`)

    const latestS3BaseUrl = `master-report/${projectPath}/check-console/local/latest`
    await uploadDir2S3('./report', '9w-internal-master-report', latestS3BaseUrl)
    console.log(`\nLatest Report URL: ${chalk.cyan(`https://master-report.tools.gravityapps.net/${latestS3BaseUrl}/index.html`)}`)
  }
}

main()