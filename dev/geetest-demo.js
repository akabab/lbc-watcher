const puppeteer = require('puppeteer')
const datadome = require('../lib/datadome')

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

  await page.goto('https://www.geetest.com/en/demo', { waitUntil: 'networkidle2' })

  const geetestCaptchaElementHandle = await page.waitForSelector('.tab-item.tab-item-1')
  await geetestCaptchaElementHandle.click()

  const solved = await datadome.solveGeetestCaptcha(page, page.mainFrame())

  console.log(solved ? 'Solved' : 'Not solved')

  await browser.close()
}

run()
