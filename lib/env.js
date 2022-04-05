'use strict'

const path = require('path')

require('dotenv').config()

module.exports = {
  ...process.env,
  DEBUG_BOT: !!+process.env.DEBUG_BOT || false,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_BOT_POLLING_OFFSET: Number(process.env.TELEGRAM_BOT_POLLING_OFFSET),
  CHROME_IS_HEADLESS: !!+process.env.CHROME_IS_HEADLESS || false,
  CHROME_REMOTE_PORT: process.env.CHROME_REMOTE_PORT || 9222,
  CHROME_BINARY_PATH: process.env.CHROME_BINARY_PATH || '/usr/bin/google-chrome-stable',
  CHROME_USER_DATA_DIR: process.env.CHROME_USER_DATA_DIR || '/tmp/cuud',
  CHROME_LOGS_FILE_PATH: process.env.CHROME_LOGS_FILE_PATH || path.join(__dirname, 'browser.log'),
  CHROME_WINDOW_SIZE: process.env.CHROME_WINDOW_SIZE || '1920,1080',
  WATCHER_DUMP_FILE_PATH: process.env.WATCHER_DUMP_FILE_PATH || path.join(__dirname, 'dump.json'),
  WATCHER_DEFAULT_DELAY_IN_SECONDS: Number(process.env.WATCHER_DEFAULT_DELAY_IN_SECONDS),
  WATCHER_MAX_RETRIES_BEFORE_ABORT: 3,
  DATADOME_GEETEST_MAX_TRIES: 5,
  WINDOW_WIDTH: Number(process.env.WINDOW_WIDTH) || 1280,
  WINDOW_HEIGHT: Number(process.env.WINDOW_HEIGHT) || 800,
  SHOULD_USE_XVFB: !!+process.env.SHOULD_USE_XVFB || false
}
