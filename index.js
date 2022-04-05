// == DEPENDENCIES ==
const fs = require('fs')
const { spawn } = require('child_process')
const puppeteer = require('puppeteer-core')
const Xvfb = require('xvfb')
const TelegramBot = require('node-telegram-bot-api')
const ProxyChain = require('proxy-chain')

const Env = require('./lib/env')
const Telegram = require('./lib/telegram')
const Db = require('./lib/db')
const Watcher = require('./lib/watcher')
const { wait } = require('./lib/helpers')
const { terminate } = require('./lib/errors')

// -- GLOBALS
let G_BROWSER_PROCESS
let G_BROWSER
let G_XVFB

// -- ERRORS HANDLING --

// /!\ Execute this early (top of a file) in case of an internal crash
const doBeforeExit = async () => {
  // force to save the watchers
  await Db.save(Env.WATCHER_DUMP_FILE_PATH, { shouldExecuteNow: true })
  // + save a backup file
  await Db.save(Env.WATCHER_BACKUP_FILE_PATH, { shouldExecuteNow: true })
  
  await G_BROWSER.close()
  // just in case, try to kill sub-process, even if it should be killed on process exit
  G_BROWSER_PROCESS?.kill()
  
  G_XVFB?.stopSync()
}

const exitHandler = terminate(doBeforeExit)

process.on('uncaughtException', exitHandler(1, 'Unexpected Error'))
process.on('unhandledRejection', exitHandler(1, 'Unhandled Promise'))
process.on('SIGTERM', exitHandler(0, 'SIGTERM'))
process.on('SIGINT', exitHandler(0, 'SIGINT'))

// -- ENDPOINT
const getBrowserWSEndpoint = async () => {
  const filePath = Env.CHROME_LOGS_FILE_PATH

  const timeout = 20 // seconds
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
  if (!process.env.DISPLAY || Env.SHOULD_USE_XVFB) {
    // https://manpages.debian.org/testing/xvfb/xvfb-run.1.en.html
    const xvfbArgs = `-screen 0 ${Env.WINDOW_WIDTH}x${Env.WINDOW_HEIGHT}x24 -ac -nolisten unix`.split(' ') // -nolisten tcp ?

    G_XVFB = new Xvfb({
      silent: process.env.DEBUG,
      xvfb_args: xvfbArgs
    })

    G_XVFB.startSync()
    console.log(`X Virtual Frame Buffer (XVFB) server started on display [${G_XVFB._display}]`)
  }

  // LAUNCH A BROWSER (ONLY 1 IS NECESSARY)
  const command = Env.CHROME_BINARY_PATH
  const proxy =  Env.CHROME_PROXY_URL && await ProxyChain.anonymizeProxy(Env.CHROME_PROXY_URL)
  const args = [
    Env.CHROME_IS_HEADLESS ? '--headless' : '',
    `--user-data-dir=${Env.CHROME_USER_DATA_DIR}`,
    `--remote-debugging-port=${Env.CHROME_REMOTE_PORT}`,
    proxy ? `--proxy-server=${proxy}` : '',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-position=0,0',
    G_XVFB ? `--window-size=${Env.WINDOW_WIDTH},${Env.WINDOW_HEIGHT}` : '',
    G_XVFB ? `--display=${G_XVFB._display}` : ''
  ]
  const stderr = fs.openSync(Env.CHROME_LOGS_FILE_PATH, 'w')
  const options = {
    stdio: ['ignore', 'ignore', stderr]
  }

  console.log('Launching browser...', `${command} ${args.join(' ')}`)
  G_BROWSER_PROCESS = spawn(command, args, options)

  const browserProcessExitHandler = (code, reason) => {
    console.error(reason)
    process.kill(process.pid, "SIGTERM")
  }

  G_BROWSER_PROCESS.on('uncaughtException', () => browserProcessExitHandler(1, 'CHROME: Unexpected Error'))
  G_BROWSER_PROCESS.on('unhandledRejection', () => browserProcessExitHandler(1, 'CHROME: Unhandled Promise'))
  G_BROWSER_PROCESS.on('SIGTERM', () => browserProcessExitHandler(0, 'CHROME: SIGTERM'))
  G_BROWSER_PROCESS.on('SIGINT', () => browserProcessExitHandler(0, 'CHROME: SIGINT'))

  const browserWSEndpoint = await getBrowserWSEndpoint()

  if (!browserWSEndpoint) {
    console.error(`Could not get browser WS endpoint, check file ${Env.CHROME_LOGS_FILE_PATH} for more infos`)
    process.exit(0)
  }

  console.log(`Browser launched [pid: ${G_BROWSER_PROCESS.pid}] and listenning to: ${browserWSEndpoint}`)

  G_BROWSER = await puppeteer.connect({
    browserWSEndpoint,
    defaultViewport: null
  })

  Db.setStateKeyValue('browser', G_BROWSER)

  // DEBUG BOT DETECTION
  if (Env.DEBUG_BOT) { await debugbotHandler() }

  // LOAD DB
  await Db.load()

  // INIT BOT
  let bot = new TelegramBot(Env.TELEGRAM_BOT_TOKEN, { polling: false })

  // Ignore all previous updates
  const updates = await bot.getUpdates()
  const pollingOffset = updates.pop()?.update_id + 1 || 0
  const pollingOptions = { params: { offset: pollingOffset } }
  // await bot.close()
  bot = new TelegramBot(Env.TELEGRAM_BOT_TOKEN, { polling: pollingOptions })

  const { chats } = Db.getState()
  Telegram.setupBot(bot, { chats })
  Db.setStateKeyValue('bot', bot)

  // START ACTIVE WATCHERS
  const watchers = Db.getAllWatchers()
  for (const watcher of watchers) {
    if (watcher.active) {
      Watcher.start(watcher)
      await wait(5000)
    }
  }
}

main()
