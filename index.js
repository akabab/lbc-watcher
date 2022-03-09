// == DEPENDENCIES ==
const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')
const { exec } = require('child_process')

const { createCursor, getRandomPagePoint, installMouseHelper } = require("ghost-cursor")

// puppeteer-extra is a drop-in replacement for puppeteer,
// it augments the installed puppeteer with plugin functionality.
// Any number of plugins can be added through `puppeteer.use()`
const puppeteer = require('puppeteer-extra')

// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

// Add adblocker plugin to block all ads and trackers (saves bandwidth)
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker')
puppeteer.use(AdblockerPlugin({ blockTrackers: true }))



const TelegramBot = require('node-telegram-bot-api')

require('dotenv').config()

// == HELPERS ==
const wait = ms => new Promise(_ => setTimeout(_, ms))


// == GLOBALS == //
const ENV = {
  AMIABOT: !!+process.env.AMIABOT || false,
  CHROME_IS_HEADLESS: !!+process.env.CHROME_IS_HEADLESS || false,
  CHROME_REMOTE_PORT: process.env.CHROME_REMOTE_PORT || 9222,
  CHROME_BINARY: (process.env.CHROME_BINARY || '/usr/bin/google-chrome-stable').replace(/ /g, '\\ '),
  CHROME_USER_DATA_DIR: process.env.CHROME_USER_DATA_DIR || '/tmp/cuud',
  CHROME_LOGS_FILE_PATH: process.env.CHROME_LOGS_FILE_PATH || path.join(__dirname, 'browser.log'),
  WATCHER_DUMP_FILE_PATH: process.env.WATCHER_DUMP_FILE_PATH || path.join(__dirname, 'dump.json'),
  WATCHER_DEFAULT_DELAY_IN_SECONDS: Number(process.env.WATCHER_DEFAULT_DELAY_IN_SECONDS),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN
}

let G_BROWSER

let G_DUMP = {}

const G_ACTIVE_PAGES = {}

// == WS ENDPOINT == //

/**
* Poll browser.log periodically until we see the wsEndpoint
* that we use to connect to the browser.
*/
const getBrowserWsEndpoint = async () => {
  const filePath = ENV.CHROME_LOGS_FILE_PATH

  // try 10 times every .5 second
  for (let i = 0; i <= 10; i++) {
    await wait(500)
    if (fs.existsSync(filePath)) {
      const logContents = fs.readFileSync(filePath).toString()
      const regex = /DevTools listening on (.*)/gi
      const match = regex.exec(logContents)

      if (match) {
        const browserWSEndpoint = match[1]
        return browserWSEndpoint
      }
    }
  }

  return undefined
}

// == DUMP == //
const persistDumpFile = async () => {
  const filePath = ENV.WATCHER_DUMP_FILE_PATH

  console.log('Persisting dump file...', filePath)
  try {
    /* await */ fsp.writeFile(filePath, JSON.stringify(G_DUMP, null, 2))
    console.log('Dump file successfully saved', filePath)
  } catch (err) {
    console.error('Failed to save to dump file', filePath, err)
  }
}

const loadDumpFile = async () => {
  const filePath = ENV.WATCHER_DUMP_FILE_PATH

  console.log('Loading dump file...', filePath)
  try {
    const content = await fsp.readFile(filePath)
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

const scrapOffers = async (search, page) => {
  await page.reload()

  const screenFilePath = path.join(__dirname, `screens/${Date.now()}-screen.png`)
  await page.screenshot({ path: screenFilePath })

  await page.waitForSelector('script#__NEXT_DATA__')
  const datas = await page.evaluate(() => document.querySelector('script#__NEXT_DATA__').innerHTML)
  const offers = JSON.parse(datas)
    .props.pageProps.searchData.ads
    .map(parseOffer)

  return offers
}

const searchHandler = async (search, page) => {
  console.log(`[${search.id}] New search...`)

  // SEARCH
  const offers = await scrapOffers(search, page)

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
  if (newOffers.length > 0 && newOffers.length < 5) {

    newOffers.map(o => {
      Bot.sendMessage(search.chatId, `
        New offer ${o.title}
        Date: ${o.date}
        Price: ${o.price} €
        Where: ${o.where}
        ${o.link}
      `)
    })
  } else if (newOffers.length >= 5) {
    Bot.sendMessage(search.chatId, `${newOffers.length} new offers, go to ${search.url}`)
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

  // Add a 'ghost' cursor to the page object
  const cursor = createCursor(page) //, await getRandomPagePoint(page), false)
  page.humanclick = cursor.click

  await installMouseHelper(page)

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

  // Cookies
  await wait(3000)

  try {
    // Button "Personnaliser"
    await page.waitForSelector('#didomi-notice-learn-more-button', { timeout: 3000 })
    await page.humanclick("button#didomi-notice-learn-more-button")
    await sleep(1000)
    // Button "Tout refuser"
    await page.humanclick('button[aria-label="Refuser notre traitement des données et fermer"]')
    console.log(`[${search.id}] Cookies refused`)
    console.log('Cookies refused')
  } catch {
    /* Cookies popup didn't show .. continue */
    console.log(`[${search.id}] already handled`)
  }

//   Continuer sans accepter didomi-notice-disagree-button

//   await page.locator("button.didomi-components-radio__option didomi-components-radio__option--selected didomi-components-radio__option--disagree[aria-describedby=didomi-purpose-mesureaudience]").click()
//   await wait(1000)
//   await page.locator("button.didomi-components-radio__option didomi-components-radio__option--selected didomi-components-radio__option--disagree[aria-describedby=didomi-purpose-experienceutilisateur]").click()
//   await wait(1000)
//   await page.locator("button.didomi-components-radio__option didomi-components-radio__option--selected didomi-components-radio__option--disagree[aria-describedby=didomi-purpose-2fFFcc]").click()
//   await wait(1000)
//   await page.locator("button.didomi-components-radio__option didomi-components-radio__option--selected didomi-components-radio__option--disagree[aria-describedby=didomi-purpose-qB2C83]").click()
//   await wait(1000)
//
//   await page.locator("button[aria-describedby=didomi-consent-popup-information-save]").click()
//   await wait(1000)

  // await page.locator('button#didomi-notice-agree-button').click()
  // console.log(`[${search.id}] Cookies accepted`)

  G_ACTIVE_PAGES[search.id] = page

  searchHandler(search, page)
}


const main = async () => {
  // const ps = exec(`pkill -f "remote-debugging-port=92"`, console.log)
  // console.log({ps})
  // ps.kill()
  // return

  await loadDumpFile()

  // LAUNCH A BROWSER (ONLY 1 IS NECESSARY)
  const command = ENV.CHROME_BINARY
    + (ENV.CHROME_IS_HEADLESS ? ' --headless': '')
    // + ` --display=${display._display}`
    + ` --window-size=1920,1080`
    + ` --user-data-dir=${ENV.CHROME_USER_DATA_DIR}`
    + ` --remote-debugging-port=${ENV.CHROME_REMOTE_PORT}`
    + ' --no-first-run'
    + ' --no-default-browser-check'
    + ` 2> ${ENV.CHROME_LOGS_FILE_PATH} &`

  console.log('Launching browser...', command)
  const browserProcess = exec(command, (error, stdout, stderr) => console.log({error, stdout, stderr}))
//
//   process.on('exit', async () => {
//     console.log(`EXIT`)
//
//     await setTimeout(() => {
//       console.log(`EXIT, killing browser process pid: ${browserProcess.pid}`)
//       browserProcess.kill('SIGHUP')
//     }, 5000)
//     // exec(`pkill -f "remote-debugging-port=92"`)
//   })

  const browserWSEndpoint = await getBrowserWsEndpoint()

  if (!browserWSEndpoint) {
    console.error(`Could not get browser WS endpoint, check file ${ENV.CHROME_LOGS_FILE_PATH} for more infos`)
    process.exit(0)
  }

  console.log(`Browser lauched and listenning to: ${browserWSEndpoint}`)

  G_BROWSER = await puppeteer.connect({
    browserWSEndpoint,
    defaultViewport: null //{ width: 1200, height: 900 }
  })


  // DEBUG BOT DETECTION
  if (ENV.AMIABOT) {
    // await page.goto('https://antoinevastel.com/bots/')
    // await page.waitForTimeout(5000)
    // await page.screenshot({ path: 'fp.png', fullPage: true })
    // await page.goto('https://antoinevastel.com/bots/datadome')
    // await page.waitForTimeout(5000)
    // await page.screenshot({ path: 'dd.png', fullPage: true })
    const page = await G_BROWSER.newPage()

    await page.goto('https://bot.sannysoft.com')
    await page.waitForTimeout(5000)
    await page.screenshot({ path: 'fp-sannysoft.png', fullPage: true })

    console.log(`All done, check the screenshot. ✨`)
    await G_BROWSER.close()
    process.exit(0)
  }

  // START WATCHERS FOR ALL SEARCHS
  const searchs = Object.values(G_DUMP)
  for (let search of searchs) {
    startSearchWatcher(search)
    await wait(10000)
  }
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
