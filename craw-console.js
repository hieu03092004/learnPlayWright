const chalk = require('chalk')
const { chromium, firefox, webkit } = require('playwright')

const parseURL = (url) => {
  try {
    const urlInstance = new URL(url)
    const { username, password } = urlInstance
    urlInstance.username = ''
    urlInstance.password = ''
    return { username, password, url: urlInstance.toString() }
  // eslint-disable-next-line no-empty
  } catch (error) {}
  return { username: null, password: null, url }
}
const BROWSER_OPTION = { chromium, firefox, webkit }

const crawConsoleBrowser = async (crawParams = {}) => {
  let { url } = crawParams
  const { browser } = crawParams
  if (!url || !browser) {
    throw new Error('Invalid payload input')
  }
  const browserOS = BROWSER_OPTION[browser]
  if (!browserOS) {
    throw new Error('Can\'t support this browser')
  }

  const logObject = {}
  const browserLaunch = await browserOS.launch({
    headless: true,
    args: browser === 'webkit' ? [] : ['--no-sandbox', '--disable-setuid-sandbox']
  })
  console.log(`[Start browser ${browser} - ${browserLaunch.version()}] success`)
  const params = { ignoreHTTPSErrors: true }
  const itemURL = parseURL(url)
  // console.log('itemURL', itemURL)
  if (itemURL?.username || itemURL?.password) {
    params.httpCredentials = { username: decodeURIComponent(itemURL.username), password: decodeURIComponent(itemURL.password) }
  }
  url = itemURL.url
  const context = await browserLaunch.newContext(params)
  const page = await context.newPage()

  // try {
  //   const parseUrl = new URL(url)
  //   if (parseUrl.username && parseUrl.password) {
  //     const auth = Buffer.from(`${parseUrl.username}:${parseUrl.password}`).toString('base64')
  //     await page.setExtraHTTPHeaders({
  //       Authorization: `Basic ${auth}`
  //     })
  //   }
  // } catch (error) {
  //   throw new Error(error)
  // }

  // reset page
  page.on('console', (msg) => {
    const msgType = msg.type()
    const msgKey = ['warn', 'error'].includes(msgType) ? msgType : 'info'
    if (!logObject[msgKey]) logObject[msgKey] = []
    logObject[msgKey].push(msg.text())
  })

  await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch((error) => console.log(chalk.red(`Error: ${error && error.message}`)))
  await page.evaluate(() => {
    document.querySelector('#onetrust-accept-btn-handler')?.click()
    document?.querySelector("#usercentrics-root")?.shadowRoot?.querySelector("[data-testid='uc-accept-all-button']")?.click()
  })
  await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch((error) => console.log(chalk.red(`Error: ${error && error.message}`)))

  /** scroll by mouse */
  const viewportHeight = await page.viewportSize().height
  const stepHeight = Math.round(viewportHeight / 3)
  let distanceToScroll = await page.evaluate(() => document.body.scrollHeight)
  let scrollDistance = 0
  while (scrollDistance < distanceToScroll) {
    await page.mouse.wheel(0, stepHeight)
    scrollDistance += stepHeight
    distanceToScroll = await page.evaluate(() => document.body.scrollHeight)
    await page.waitForTimeout(stepHeight)
    console.log({ scrollDistance, distanceToScroll })
  }

  // /** scroll to bottom by scroll To */
  // await page.evaluate(async () => {
  //   for (let i = 0; i < document.body.scrollHeight; i += 100) {
  //     window.scrollTo(0, i)
  //   }
  // })

  await page.waitForTimeout(5 * 1000) /** wait more 30s  */
  await browserLaunch.close()
  console.log(`[Stop browser ${browser}] success`)

  return { [browser]: logObject, version: browserLaunch.version() }
}

const crawConsoleALLBrowser = async ({ url }) => {
  const consoles = {}
  const versions = {}
  for (const browser in BROWSER_OPTION) {
    if (Object.prototype.hasOwnProperty.call(BROWSER_OPTION, browser)) {
      const data = await crawConsoleBrowser({ url, browser })
      consoles[browser] = data[browser]
      versions[browser] = data.version
    }
  }
  return { consoles, versions }
}

module.exports = {
  crawConsoleALLBrowser
}