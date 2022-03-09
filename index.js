// == DEPENDENCIES ==
const fs = require('fs').promises
const path = require('path')
const { firefox } = require('playwright-firefox') // Or 'chromium' or 'webkit'.
// const { chromium } = require('playwright-chromium') // Or 'chromium' or 'webkit'.
const TelegramBot = require('node-telegram-bot-api')

const browser = firefox

require('dotenv').config()

// == HELPERS ==
const wait = ms => new Promise(_ => setTimeout(_, ms))

// == GLOBALS == //
const ENV = {
  WATCHER_DUMP_FILE_PATH: path.join(__dirname, process.env.WATCHER_DUMP_FILE_PATH || 'dump.json'),
  WATCHER_DEFAULT_DELAY_IN_SECONDS: Number(process.env.WATCHER_DEFAULT_DELAY_IN_SECONDS),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN
}

let G_BROWSER

let G_DUMP = {}

const G_ACTIVE_PAGES = {}

// == DUMP == //
const persistDumpFile = async () => {
  const filePath = ENV.WATCHER_DUMP_FILE_PATH

  console.log('Persisting dump file...', filePath)
  try {
    /* await */ fs.writeFile(filePath, JSON.stringify(G_DUMP, null, 2))
    console.log('Dump file successfully saved', filePath)
  } catch (err) {
    console.error('Failed to save to dump file', filePath, err)
  }
}

const loadDumpFile = async () => {
  const filePath = ENV.WATCHER_DUMP_FILE_PATH

  console.log('Loading dump file...', filePath)
  try {
    const content = await fs.readFile(filePath)
    G_DUMP = JSON.parse(content)
    console.log('Dump file successfully loaded', filePath)
  } catch (err) {
    /* ignore file missing ENOENT and continue */
    console.log('No dump file found', filePath, err)
  }
}

// == SEARCH == //

const parseOffer = offer => ({
  id: String(offer.list_id),
  date: `${offer.index_date} GMT+0100`,
  title: offer.subject,
  description: offer.body,
  price: (offer.price && offer.price[0]) || 'N/A',
  where: offer.location.city,
  link: offer.url,
  image: offer.images.thumb_url
})

const scrapOffers = async page => {
  await page.reload()

  // Get page title
  const title = await page.locator("head title").textContent()
  console.log({title})

  const datas = await page.locator('script#__NEXT_DATA__').textContent()
  const offers = JSON.parse(datas)
    .props.pageProps.searchData.ads
    .map(parseOffer)

  return offers
}

const searchHandler = async (search, page) => {
  console.log(`[${search.id}] New search...`)

  // SEARCH
  const offers = await scrapOffers(page)

  const lastSearchDate = new Date(search.lastSearchDate)

  // HANDLE results
  const newOffers = offers
    .filter(o => new Date(o.date) > lastSearchDate)
    .sort((o1, o2) => new Date(o1) < new Date(o2)) // by date, newest first

  if (newOffers.length >= 1) {
    search.lastSearchDate = newOffers[0].date
  }

  console.log(`[${search.id}] Found ${newOffers.length} new offers`)

  // TELEGRAM MESSAGES
  if (newOffers.length === 1) {
    const o = newOffers[0]
    Bot.sendMessage(search.chatId, `
      New offer ${o.title}
      Date: ${o.date}
      Price: ${o.price} €
      Where: ${o.where}
      ${o.link}
    `)
  } else if (newOffers.length > 1) {
    Bot.sendMessage(search.chatId, `${offers.length} new offers, go to ${search.url}`)
  }

  // PERSISTS DUMP
  persistDumpFile()

  // NEW SEARCH AFTER DELAY
  // add some random delay (between -10 and 10 seconds)
  const randomSeconds = Math.random() * 20 - 10
  const ms = (search.delay + randomSeconds) * 1000

  console.log(`[${search.id}] Next search in ${ms / 1000} seconds`)
  await wait(ms)

  // NEW SEARCH
  searchHandler(search, page)
}

const startSearchWatcher = async search => {
  // OPEN PAGE (once)
  console.log(`[${search.id}] New page`)
  const page = await G_BROWSER.newPage()
  await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:91.0) Gecko/20100101 Firefox/91.0' })

  if (process.env.DEBUG) {
    page.on('request', async r => {
      if (search.url === r._initializer.url) {
        console.log(search.id, 'REQUEST', { headers: await r.allHeaders() })
      }
    })

    page.on('response', async r => {
      if (search.url === r._initializer.url) {
        console.log(search.id, 'RESPONSE', { statusCode: r.status(), headers: await r.allHeaders() })
      }
    })
  }

  await page.goto(search.url)

  // Accept cookies
  await page.locator('button#didomi-notice-agree-button').click()
  console.log(`[${search.id}] Cookies accepted`)

  G_ACTIVE_PAGES[search.id] = page

  searchHandler(search, page)
}

const main = async () => {
  await loadDumpFile()

  // LAUNCH A BROWSER (ONLY 1 IS NECESSARY)
  console.log('Launching browser...')
  G_BROWSER = await browser.launch({
    headless: false,
    args: ['--start-maximized']
    // slowMo: 70  // seems to work without bot detection at 100% rate
  })

  // const context = await browser.newContext({ viewport: null }) ???
  console.log('Browser launched', G_BROWSER._initializer)

  // START WATCHERS FOR ALL SEARCHS
  const searchs = Object.values(G_DUMP)
  searchs.map(startSearchWatcher) // TODO: handles errors ? Promise.all ?
}

// == TELEGRAM == //
const Bot = new TelegramBot(ENV.TELEGRAM_BOT_TOKEN, { polling: true })

Bot.onText(/^(\/list|\/ls)$/, msg => {
  const chatId = msg.chat.id

  const formatSearchText = s => {
    const searchTextMatch = s.url.match(/text=(.*)&loc/)
    return searchTextMatch && searchTextMatch.length > 1 ? searchTextMatch[1] : '???'
  }
  const formatSearch = s => `| ${s.id} | [${formatSearchText(s)}](${s.url}) | ${s.delay}s | ${s.active ? 'yes' : 'no'} |`

  const searchs = Object.values(G_DUMP).filter(s => s.chatId === chatId)

  const message = searchs.map(formatSearch).join('\n')

  Bot.sendMessage(chatId, message)
})

// stop <pid>
// delete del <pid>
// setdelay <pid> <delay>


Bot.onText(/^\/new (.+)/, (msg, match) => {
  const chatId = msg.chat.id
  const command = match[1].split(' ')

  const url = command[0]
  const delay = Number(command[1]) || 300 // TODO: check for range min max and isInteger

  if (!url.startsWith('https://www.leboncoin.fr/recherche?')) {
    Bot.sendMessage(chatId, 'INVALID_FORMAT /new <URL> <?DELAY_IN_SECONDS>')
    return
  }

  const id = `${chatId}-${url}`

  const newSearch = {
    id,
    chatId,
    url,
    delay,
    'active': true,
    'lastSearchDate': "2000-01-01T00:00:00.000Z"
  }

  G_DUMP[id] = newSearch

  persistDumpFile()

  startSearchWatcher(newSearch)

  Bot.sendMessage(chatId, 'NEW_SUCCESS')
})

Bot.onText(/^\/id$/, msg => {
  const chatId = msg.chat.id

  Bot.sendMessage(chatId, `Chat ID: ${chatId}`)
})

main()
