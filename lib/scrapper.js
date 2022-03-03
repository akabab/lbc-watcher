const { firefox } = require('playwright-firefox') // Or 'chromium' or 'webkit'.

let browser

const parseOffer = offer => ({
  id: String(offer.list_id),
  date: offer.index_date,
  title: offer.subject,
  description: offer.body,
  price: offer.price && offer.price[0] || 'N/A',
  where: offer.location.city,
  link: offer.url,
  image: offer.images.thumb_url
})

const init = async () => {
  browser = await firefox.launch({
    headless: true,
    slowMo: 70  // seems to work without bot detection at 100% rate
  })
}

const recoverOffers = async url => {

  if (!browser) {
    return console.error("No browser, please use `init` method to init browser")
  }

  const page = await browser.newPage()
//
//   page.on('response', r => {
//     console.log({r,
//       status: r.status(),
//       headers: r.allHeaders(),
//     })
//   })

  await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:91.0) Gecko/20100101 Firefox/91.0' })

  console.log(`Searching url : '${url}'`)

  await page.goto(url)

  // await page.screenshot({ path: 'screenshot.before.png' })

  // Get page title
  const title = await page.locator("head title").textContent()
  console.log({title})

  // Accept cookies
  await page.locator("button#didomi-notice-agree-button").click()

  // Gathering JSON offers data
  const datas = await page.locator("script#__NEXT_DATA__").textContent()
  const offers = JSON.parse(datas).props.pageProps.searchData.ads

  // await page.screenshot({ path: 'screenshot.after.png' })

  return offers.map(parseOffer)
}

module.exports = {
  init,
  recoverOffers,
  end: () => browser && browser.close()
}
