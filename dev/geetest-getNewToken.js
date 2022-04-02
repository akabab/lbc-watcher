const puppeteer = require('puppeteer')
const Datadome = require('../lib/datadome')

const datadomeHandler = async (browser, page) => {
  const captchaIframeElementHandle = await page.$('iframe[src^="https://geo.captcha-delivery.com/captcha/"')
  const ddCaptchaUrl = await page.evaluate(eh => eh.getAttribute('src'), captchaIframeElementHandle)
  const newPage = await browser.newPage()
  await newPage.goto(ddCaptchaUrl)

  // Datadome valid cookie token
  const token = await Datadome.getNewToken(newPage)

  console.log(`New token: ${token}`)
}

const run = async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-position=0,0',
      '--window-size=1080,720',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  })
  const page = await browser.newPage()

  await page.goto('https://www.leboncoin.fr')

  const dd = await page.$('meta[content^="https://img.datadome.co/captcha"')

  if (dd) {
    try {
      await datadomeHandler(browser, page)
    } catch (e) {
      console.error(e)
    }
  }

  await browser.close()
}

run()
