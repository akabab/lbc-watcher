// == DEPENDENCIES ==
const fs = require('fs')
const { spawn } = require('child_process')
const { O_WRONLY, O_CREAT, O_TRUNC } = require('fs').constants

let G_BROWSER_PROCESS

// /!\ Execute this early (top of a file) in case of an internal crash
process.on('exit', () => {
  // If a child process exists, kill it
  G_BROWSER_PROCESS?.kill()
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
  const command = ENV.CHROME_BINARY_PATH
  const args = [
    `--remote-debugging-port=${ENV.CHROME_REMOTE_PORT}`,
    '--user-data-dir=/tmp/cuud/',
    '--no-first-run',
    '--no-default-browser-check'
  ]

  const err = fs.openSync(ENV.CHROME_LOGS_FILE_PATH, O_WRONLY, O_CREAT, O_TRUNC)

  const options = {
    stdio: ['ignore', 'ignore', err]
  }

  console.log('Launching browser...', command)
  G_BROWSER_PROCESS = spawn(command, args, options)

  //   browserProcess.stdout.on('data', (data) => {
  //     console.log(`ps stdout: ${data}`)
  //   })
  //
  //   browserProcess.stderr.on('data', (data) => {
  //     console.error(`ps stderr: ${data}`)
  //   })

  const browserWSEndpoint = await getBrowserWSEndpoint()

  if (!browserWSEndpoint) {
    console.error(`Could not get browser WS endpoint, check file ${ENV.CHROME_LOGS_FILE_PATH} for more infos`)
    process.exit(0)
  }

  console.log(`Browser launched [pid: ${G_BROWSER_PROCESS.pid}] and listenning to: ${browserWSEndpoint}`)

  // Exemple of bad code executing after child process is spawned, and crashing app.
  // G_BROWSER_PROCESS.on('exit', ...code => {})
}

main()
