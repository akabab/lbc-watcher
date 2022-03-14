const puppeteer = require('puppeteer')
const datadome = require('../lib/datadome')

const datadomeHandler = async page => {
  const captchaIframeElementHandle = await page.$('iframe[src^="https://geo.captcha-delivery.com/captcha/"')
  const frame = await captchaIframeElementHandle.contentFrame()

  let tries = 0
  const maxTries = 15
  while (tries++ < maxTries) {
    if (await datadome.solveGeetestCaptcha(page, frame)) {
      console.log(`Succeed in ${tries} tries`)
      return
    }
  }

  console.log(`Failed after ${tries} tries`)
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
      await datadomeHandler(page)
    } catch (e) {
      // Handle dd failed to resolve captcha
      console.error(e)
    }
  }

  console.log('DONE')

  await browser.close()
}

run()
