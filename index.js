// == DEPENDENCIES ==
const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')
const { spawn } = require('child_process')

const { createCursor, installMouseHelper } = require('ghost-cursor')

const puppeteer = require('puppeteer-core')

const TelegramBot = require('node-telegram-bot-api')

require('dotenv').config()

// == HELPERS ==
const wait = ms => new Promise(_ => setTimeout(_, ms))

// == ENVIRONEMENT ==
const ENV = {
  DEBUG_BOT: !!+process.env.DEBUG_BOT || false,
  CHROME_IS_HEADLESS: !!+process.env.CHROME_IS_HEADLESS || false,
  CHROME_REMOTE_PORT: process.env.CHROME_REMOTE_PORT || 9222,
  CHROME_BINARY_PATH: process.env.CHROME_BINARY_PATH || '/usr/bin/google-chrome-stable',
  CHROME_USER_DATA_DIR: process.env.CHROME_USER_DATA_DIR || '/tmp/cuud',
  CHROME_LOGS_FILE_PATH: process.env.CHROME_LOGS_FILE_PATH || path.join(__dirname, 'browser.log'),
  CHROME_WINDOW_SIZE: process.env.CHROME_WINDOW_SIZE || '1920,1080',
  WATCHER_DUMP_FILE_PATH: process.env.WATCHER_DUMP_FILE_PATH || path.join(__dirname, 'dump.json'),
  WATCHER_DEFAULT_DELAY_IN_SECONDS: Number(process.env.WATCHER_DEFAULT_DELAY_IN_SECONDS),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_BOT_POLLING_OFFSET: Number(process.env.TELEGRAM_BOT_POLLING_OFFSET)
}

// == GLOBALS == //
let G_BROWSER_PROCESS
let G_BROWSER

let G_BOT
let G_IAMROBOT = 0

let G_CHATS = {}
let G_PAGES = {}

// /!\ Execute this early (top of a file) in case of an internal crash
process.on('exit', () => {

  // If a child process exists, kill it
  G_BROWSER_PROCESS?.kill()
})

// == TELEGRAM == //
const setupBot = Bot => {
  Bot.on('polling_error', error => { console.error(error) })

  // /id
  Bot.onText(/^\/id$/, msg => { Bot.sendMessage(msg.chat.id, `Chat ID: ${msg.chat.id}`) })

  Bot.onText(/^\/seppuku$/, async msg => {
    Bot.sendMessage(msg.chat.id, `Chat ID: ${msg.chat.id}`)

    await Bot.sendMessage(msg.chat.id, `Bye Bye cruel world, I will return`)

    process.exit(0)
  })

  // /list | /ls (alias)
  Bot.onText(/^(\/list|\/ls)$/, msg => {
    const chatId = msg.chat.id

    const format = w => `<${w._pid}> ${w.url} ${w.delay}s ${w.active ? 'active' : 'stopped'} `

    const thisChatWatchers = G_CHATS[chatId].watchers

    const message = thisChatWatchers.length > 0
      ? thisChatWatchers
          .filter(watcher => !!watcher === true) // remove empty (deleted) watchers
          .map(format)
          .join('\n')
      : 'You are not watching anything, start a new watcher with /new command'

    Bot.sendMessage(chatId, message) //, { parse_mode: 'MarkdownV2' })
  })

  // /new <url> <delay?>
  Bot.onText(/^\/new (.+)/, (msg, match) => {
    const chatId = msg.chat.id
    const args = match[1].split(' ')

    const url = args[0]
    const delay = Number(args[1]) || 300 // TODO: check for range min max and isInteger

    if (!url.startsWith('https://www.leboncoin.fr/recherche?')) {
      Bot.sendMessage(chatId, 'INVALID_FORMAT /new <URL> <?DELAY_IN_SECONDS>')
      return
    }

    const newWatcher = {
      id: `${chatId}-${url}`,
      chatId,
      url,
      delay,
      active: true,
      lastSearchDate: '2000-01-01T00:00:00.000Z'
    }

    if (!G_CHATS[chatId]) {
      G_CHATS[chatId] = {
        watchers: []
      }
    }

    newWatcher._pid = G_CHATS[chatId].watchers.length

    G_CHATS[chatId].watchers = [ ...G_CHATS[chatId].watchers, newWatcher ]

    persistDumpFile()

    startWatcher(newWatcher)

    Bot.sendMessage(chatId, `<${newWatcher._pid}> Now watching [${url}] every ${delay} seconds.`)
  })

  // /setdelay <pid> <delay>
  Bot.onText(/^\/setdelay (\d+) (\d+)/, (msg, match) => {
    const chatId = msg.chat.id
    const pid = Number(match[1])
    const delay = Number(match[2])

    const thisChatWatchers = G_CHATS[chatId].watchers

    if (pid < 0 || pid >= thisChatWatchers.length || !thisChatWatchers[pid]) {
      Bot.sendMessage(chatId, `ERROR: INVALID_PID`)
      return
    }

    if (delay < 60) {
      Bot.sendMessage(chatId, 'ERROR: INVALID_DELAY: [60-99999]')
      return
    }

    const watcher = thisChatWatchers[pid]
    watcher.delay = delay

    persistDumpFile()

    Bot.sendMessage(chatId, `<${pid}> is now set to be watched every ${delay} seconds`)
  })

  // /stop <pid>
  Bot.onText(/^\/stop (\d+)$/, (msg, match) => {
    const chatId = msg.chat.id
    const pid = Number(match[1])

    const thisChatWatchers = G_CHATS[chatId].watchers

    if (pid < 0 || pid >= thisChatWatchers.length || !thisChatWatchers[pid]) {
      Bot.sendMessage(chatId, `ERROR: INVALID_PID`)
      return
    }

    const watcher = thisChatWatchers[pid]

    if (!watcher.active) {
      Bot.sendMessage(chatId, `<${pid}> is already 'stopped'`)
      return
    }

    watcher.active = false

    persistDumpFile()

    Bot.sendMessage(chatId, `<${pid}> is now 'stopped'`)
  })

  // /start <pid>
  Bot.onText(/^\/start (\d+)$/, (msg, match) => {
    const chatId = msg.chat.id
    const pid = Number(match[1])

    const thisChatWatchers = G_CHATS[chatId].watchers

    if (pid < 0 || pid >= thisChatWatchers.length || !thisChatWatchers[pid]) {
      Bot.sendMessage(chatId, `ERROR: INVALID_PID`)
      return
    }

    const watcher = thisChatWatchers[pid]

    if (watcher.active) {
      Bot.sendMessage(chatId, `<${pid}> is already 'active'`)
      return
    }

    watcher.active = true

    persistDumpFile()

    Bot.sendMessage(chatId, `<${pid}> is now 'active'`)
  })

  // /del <pid>
  Bot.onText(/^\/del (\d+)$/, (msg, match) => {
    const chatId = msg.chat.id
    const pid = Number(match[1])

    const thisChatWatchers = G_CHATS[chatId].watchers

    if (pid < 0 || pid >= thisChatWatchers.length || !thisChatWatchers[pid]) {
      Bot.sendMessage(chatId, `ERROR: INVALID_PID`)
      return
    }

    // define inline keyboard to send to user
    const optionalParams = {
      parse_mode: 'Markdown',
      reply_markup: JSON.stringify({
        inline_keyboard: [[
          { text: 'Yes', callback_data: `DEL ${pid}` },
          { text: 'No', callback_data: 'good' }
        ]
        ]
      })
    }

    // reply when user sends a message, and send him our inline keyboard as well
    Bot.sendMessage(chatId, 'Are you sure ?', optionalParams)
  })

  // Because each inline keyboard button has callback data, you can listen for the callback data and do something with them
  Bot.on('callback_query', query => {
    if (query.data.startsWith('DEL ')) {
      const chatId = query.message.chat.id
      const pid = Number(query.data.split(' ')[1])

      const thisChatWatchers = G_CHATS[chatId].watchers

      // FLAG Watcher to get deleted during watch loop
      thisChatWatchers[pid]._SHOULD_BE_DELETED = true

      Bot.sendMessage(chatId, `<${pid}> Deleted`)
    }
  })
}

// == WS ENDPOINT == //
/**
* Poll browser.log periodically until we see the wsEndpoint
* that we use to connect to the browser.
*/
const getBrowserWSEndpoint = async () => {
  const filePath = ENV.CHROME_LOGS_FILE_PATH

  const timeout = 10 // seconds
  const every = 500 // ms
  const times = timeout * 1000 / every
  for (let i = 0; i < times; i++) {
    await wait(every)

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
    const content = Object.values(G_CHATS)
      .map(chat => chat.watchers)
      .reduce((prev, current) => [...prev, ...current], [])
      .filter(watcher => !!watcher === true) // remove empty (deleted) watchers
      .map(watcher => ({
        id: watcher.id,
        chatId: watcher.chatId,
        url: watcher.url,
        delay: watcher.delay,
        active: watcher.active,
        lastSearchDate: watcher.lastSearchDate
      }))

    fsp.writeFile(filePath, JSON.stringify(content, null, 2), { flags: 'w' })
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
    const jsonContent = JSON.parse(content)

    console.log('Dump file successfully loaded', filePath)

    return jsonContent
  } catch (err) {
    /* ignore file missing ENOENT or empty and continue */
    console.error('Dump file', err)
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

const cookiesHandler = async watcher => {
  const page = watcher._page

  try {
    // Continuer sans accepter
    // await page.humanclick('button#didomi-notice-disagree-button').click()
    // console.log(`[${watcher.id}] Cookies refused`)

    // Accepter
    // await page.humanclick('button#didomi-notice-agree-button').click()
    // console.log(`[${watcher.id}] Cookies accepted`)

    // Button "Personnaliser"
    await page.waitForSelector('#didomi-notice-learn-more-button', { timeout: 3000 })
    await page.humanclick('button#didomi-notice-learn-more-button')
    await wait(1000)
    // Button "Tout refuser"
    await page.humanclick('button[aria-label="Refuser notre traitement des données et fermer"]')
    console.log(`[${watcher.id}] Cookies refused`)
    console.log('Cookies refused')
  } catch {
    /* Cookies popup didn't show .. continue */
    console.log(`[${watcher.id}] Cookies already handled`)
  }
}

const datadomeHandler = async watcher => {
  const page = watcher._page

  try {
    await page.waitForSelector('meta[content^="https://img.datadome.co/captcha"', { timeout: 10000 })
    console.log(`[${watcher.id}] I am a robot =(`)
    G_IAMROBOT++

    if (G_IAMROBOT > 10) {
      G_BOT.sendMessage(watcher.chatId, 'Leaving this world... of humans!')
      process.exit(1)
    }

    G_BOT.sendMessage(watcher.chatId, 'I am a robot =(')
    return true
  } catch {
    console.log(`[${watcher.id}] I am human...`)
  }

  return false
}

const debugHandler = async watcher => {
  const page = watcher._page

  page.on('request', async r => {
    if (watcher.url === r._initializer.url) {
      console.log(watcher.id, 'REQUEST', { headers: await r.allHeaders() })
    }
  })

  page.on('response', async r => {
    if (watcher.url === r._initializer.url) {
      console.log(watcher.id, 'RESPONSE', { statusCode: r.status(), headers: await r.allHeaders() })
    }
  })
}

const watcherHandler = async watcher => {
  const page = watcher._page

  if (watcher._SHOULD_BE_DELETED) {
    console.log(`[${watcher.id}] DELETE, Aborting watcher...`)
    page.close()
    delete G_CHATS[watcher.chatId].watchers[watcher._pid]
    persistDumpFile()
    return
  }

  if (!watcher.active) {
    console.log(`[${watcher.id}] STOPPED, Closing page...`)
    delete page
    page.close()
    return
  }

  console.log(`[${watcher.id}] New search...`)

  await page.reload()

  // const screenFilePath = path.join(__dirname, `screens/${Date.now()}-screen.png`)
  // await page.screenshot({ path: screenFilePath })

  // Datadome
  const iambot = await datadomeHandler(watcher)

  if (!iambot) {
    // Cookies
    await cookiesHandler(watcher)

    await page.waitForSelector('script#__NEXT_DATA__')
    const datas = await page.evaluate(() => document.querySelector('script#__NEXT_DATA__').innerHTML)
    const offers = JSON.parse(datas)
      .props.pageProps.searchData.ads
      .map(parseOffer)

    const lastSearchDate = new Date(watcher.lastSearchDate)

    // HANDLE results
    const newOffers = offers
      .filter(o => new Date(o.date) > lastSearchDate)
      .sort((o1, o2) => new Date(o1.date) < new Date(o2.date)) // by date, newest first

    console.log(`[${watcher.id}] Found ${newOffers.length} new offers`)

    if (newOffers.length >= 1) {
      watcher.lastSearchDate = newOffers[0].date
      persistDumpFile()
    }

    // TELEGRAM MESSAGES
    if (newOffers.length > 0 && newOffers.length < 5) {
      newOffers.forEach(o => {
        G_BOT.sendMessage(watcher.chatId, `
          New offer ${o.title}
          Date: ${o.date}
          Price: ${o.price} €
          Where: ${o.where}
          ${o.link}
        `)
      })
    } else if (newOffers.length >= 5) {
      G_BOT.sendMessage(watcher.chatId, `${newOffers.length} new offers, go to ${watcher.url}`)
    }
  }

  // New search after random delay (between -10 and 10 seconds)
  const randomSeconds = Math.random() * 20 - 10
  const ms = (watcher.delay + randomSeconds) * 1000

  console.log(`[${watcher.id}] Next search in ${ms / 1000} seconds`)
  await wait(ms)

  watcherHandler(watcher)
}

const startWatcher = async watcher => {
  // OPEN PAGE (once)
  console.log(`[${watcher.id}] New page`)
  const page = await G_BROWSER.newPage()
  page.setDefaultTimeout(60 * 1000) // 1 min
  // await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:91.0) Gecko/20100101 Firefox/91.0' })

  // Add a 'ghost' cursor to the page object
  page.humanclick = createCursor(page) //, await getRandomPagePoint(page), false)

  await installMouseHelper(page)

  if (process.env.DEBUG) { debugHandler(watcher) }

  await page.goto(watcher.url)

  watcher._page = page

  watcherHandler(watcher)
}

const debugbotHandler = async () => {
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

  console.log('All done, check the screenshot. ✨')
  await G_BROWSER.close()
  process.exit(0)
}

const main = async () => {
  // LAUNCH A BROWSER (ONLY 1 IS NECESSARY)
  const command = ENV.CHROME_BINARY_PATH
  const args = [
    ENV.CHROME_IS_HEADLESS ? '--headless' : '',
    // `--display=${display._display}`,
    `--user-data-dir=${ENV.CHROME_USER_DATA_DIR}`,
    `--remote-debugging-port=${ENV.CHROME_REMOTE_PORT}`,
    '--no-first-run',
    '--no-default-browser-check'
  ]
  const stderr = fs.openSync(ENV.CHROME_LOGS_FILE_PATH, 'w')
  const options = {
    stdio: [ 'ignore', 'ignore', stderr ]
  }

  console.log('Launching browser...', command)
  G_BROWSER_PROCESS = spawn(command, args, options)

  const browserWSEndpoint = await getBrowserWSEndpoint()

  if (!browserWSEndpoint) {
    console.error(`Could not get browser WS endpoint, check file ${ENV.CHROME_LOGS_FILE_PATH} for more infos`)
    process.exit(0)
  }

  console.log(`Browser launched [pid: ${G_BROWSER_PROCESS.pid}] and listenning to: ${browserWSEndpoint}`)

  G_BROWSER = await puppeteer.connect({
    browserWSEndpoint,
    defaultViewport: null
  })

  // DEBUG BOT DETECTION
  if (ENV.DEBUG_BOT) { await debugbotHandler() }

  // INIT BOT
  const pollingOffset = ENV.TELEGRAM_BOT_POLLING_OFFSET
  const polling = pollingOffset ? { params: { offset: pollingOffset } } : true
  G_BOT = new TelegramBot(ENV.TELEGRAM_BOT_TOKEN, { polling })
  setupBot(G_BOT)

  // LOAD AND START WATCHERS
  const loadedWatchers = (await loadDumpFile()) || []

  for (const watcher of loadedWatchers) {

    // If entry doesn't exists, init it
    if (!G_CHATS[watcher.chatId]) {
      G_CHATS[watcher.chatId] = {
        watchers: []
      }
    }

    // ASSIGN A PID AND START THE ACTIVE ONES
    watcher._pid = G_CHATS[watcher.chatId].watchers.length

    G_CHATS[watcher.chatId].watchers = [ ...G_CHATS[watcher.chatId].watchers, watcher ]

    if (watcher.active) {
      startWatcher(watcher)

      await wait(5000)
    }
  }
}

main()
