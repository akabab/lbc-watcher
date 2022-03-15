const puppeteer = require('puppeteer')
const datadome = require('../lib/datadome')

const datadomeHandler = async page => {
  const captchaIframeElementHandle = await page.$('iframe[src^="https://geo.captcha-delivery.com/captcha/"')
  const frame = await captchaIframeElementHandle.contentFrame()

  const solveAfterNthTries = Number(process.env.TRIES) || 10
  console.log(`Will try to solve in ${solveAfterNthTries} TRIES (set ENV variable)`)
  const triesToSolve = await datadome.solveGeetestCaptcha(page, frame, solveAfterNthTries)
  console.log(`Solved in ${triesToSolve} tries`)
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
      console.error(e)
    }
  }

  await browser.close()
}

run()
