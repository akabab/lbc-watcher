const { firefox } = require('playwright'); // Or 'chromium' or 'webkit'.

const parseOffer = offer => ({
  id: offer.list_id,
  date: offer.index_date,
  title: offer.subject,
  description: offer.body,
  price: offer.price && offer.price[0] || 'N/A',
  where: offer.location.city,
  link: offer.url,
  image: offer.images.thumb_url
})

const recoverOffers = async url => {
  console.log('Launching browser..')

  const browser = await firefox.launch({
    headless: true,
    slowMo: 70  // seems to work without bot detection at 100% rate
  });

  const page = await browser.newPage();

  await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:91.0) Gecko/20100101 Firefox/91.0' })

  console.log(`Searching url : '${url}'`)

  await page.goto(url);

  // await page.screenshot({ path: 'screenshot.before.png' });

  // Accept cookies
  await page.locator("button#didomi-notice-agree-button").click()

  // Gathering JSON offers data
  const datas = await page.locator("script#__NEXT_DATA__").textContent()
  const offers = JSON.parse(datas).props.pageProps.searchData.ads

  // await page.screenshot({ path: 'screenshot.after.png' });

  await browser.close();

  return offers.map(parseOffer)
};

module.exports = {
  recoverOffers
}
