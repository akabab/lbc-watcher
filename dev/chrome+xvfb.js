// == DEPENDENCIES ==
const fs = require('fs')
const { spawn } = require('child_process')
const { O_WRONLY, O_CREAT, O_TRUNC } = require('fs').constants
const Xvfb = require('xvfb')

let G_BROWSER_PROCESS
let G_XVFB

// /!\ Execute this early (top of a file) in case of an internal crash
process.on('exit', () => {
  // If a child process exists, kill it
  G_BROWSER_PROCESS?.kill()

  G_XVFB?.stopSync()
})

const ENV = {
  CHROME_BINARY_PATH: process.env.CHROME_BINARY_PATH || '/Users/ycribier/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome',
  CHROME_REMOTE_PORT: 9229,
  CHROME_LOGS_FILE_PATH: './chrome.log'
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

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

const main = async () => {
  G_XVFB = new Xvfb({
    // silent: true,
    xvfb_args: ['-screen', '0', '1280x720x24', '-ac']
  })

  G_XVFB.startSync()

  console.log('XVFB started', { G_XVFB })

  const command = ENV.CHROME_BINARY_PATH
  const args = [
    `--remote-debugging-port=${ENV.CHROME_REMOTE_PORT}`,
    '--user-data-dir=/tmp/cuud/',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-position=0,0',
    '--window-size=1280x720',
    `--display=${G_XVFB._display}`
  ]

  const err = fs.openSync(ENV.CHROME_LOGS_FILE_PATH, O_WRONLY, O_CREAT, O_TRUNC)

  const options = {
    stdio: ['ignore', 'ignore', err]
  }

  console.log('Launching browser...', command)
  G_BROWSER_PROCESS = spawn(command, args, options)

  const browserWSEndpoint = await getBrowserWSEndpoint()

  if (!browserWSEndpoint) {
    console.error(`Could not get browser WS endpoint, check file ${ENV.CHROME_LOGS_FILE_PATH} for more infos`)
    process.exit(0)
  }

  console.log(`Browser launched [pid: ${G_BROWSER_PROCESS.pid}] and listenning to: ${browserWSEndpoint}`)
}

main()
