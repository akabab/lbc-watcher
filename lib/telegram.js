'use strict'

const {
  filterDeletedWatchers,
  formatPid,
  formatName,
  formatDelay,
  formatStatus,
  formatWatcherIdentifier
} = require('./helpers')

const Db = require('./db')
const Watcher = require('./watcher')

const setupBot = (Bot, params) => {
  const { chats } = params

  // FORMAT HELPERS
  const inlineCodeBlock = '`'
  const codeBlock = '```'

  const formatWatcherAsMarkdown = w => `| ${formatPid(w._pid)} | ${formatName(w.name).replace('...', '\\.\\.\\.')} | ${formatDelay(w.delay).replace(/(>|~)/g, '\\$1')} | ${formatStatus(w.active)} |`.replace(/\|/g, '\\|')
  const formatWatcherInInlineCodeBlock = w => `${inlineCodeBlock}${formatWatcherAsMarkdown(w)}${inlineCodeBlock}`

  const formatWatchersAsMarkdownTable = watchers => {
    const header = '| PID | NAME            |  DELAY | STATUS  |'.replace(/\|/g, '\\|')

    const formattedWatchers = watchers
      .filter(filterDeletedWatchers)
      .map(formatWatcherAsMarkdown)
      .join('\n')

    return `${codeBlock}\n${header}\n${formattedWatchers}${codeBlock}`
  }

  // EVENTS
  // Bot.on('poll', poll => { console.error('BOT POLL', { poll }) })
  // Bot.on('message', message => { console.log('BOT message', { message }) })
  Bot.on('polling_error', error => { console.error('BOT POLLING_ERROR', error) })

  Bot.onText(/^\/seppuku$/, async msg => {
    Bot.sendMessage(msg.chat.id, `Chat ID: ${msg.chat.id}`)

    await Bot.sendMessage(msg.chat.id, 'Bye Bye cruel world, I will return')

    process.exit(0)
  })

  // /id
  Bot.onText(/^\/id$/, msg => { Bot.sendMessage(msg.chat.id, `Chat ID: ${msg.chat.id}`) })

  // /list | /ls (alias)
  Bot.onText(/^(\/list|\/ls)$/, msg => {
    const chatId = msg.chat.id

    const thisChat = chats[chatId]
    if (!thisChat) {
      Bot.sendMessage('ERROR: INVALID REQUEST')
      return
    }
    const thisChatWatchers = thisChat.watchers

    const message = thisChatWatchers.length > 0
      ? formatWatchersAsMarkdownTable(thisChatWatchers)
      : 'You are not watching anything, start a new watcher with /new command'

    Bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' })
  })

  // /new <url> <delay?> <name?>
  Bot.onText(/^\/new (.+)/, (msg, match) => {
    const chatId = msg.chat.id
    const args = match[1].split(' ')

    try {
      const url = new URL(args[0])
      if (!url.href.startsWith('https://www.leboncoin.fr/')) {
        throw new Error('INVALID_URL')
      }

      url.searchParams.set('sort', 'time')

      const delay = Number(args[1]) || 300

      if (!Number.isInteger(delay) || delay < 60) {
        throw new Error('INVALID_DELAY [60-99999]')
      }

      const name = args[2] || url.searchParams.get('text') || '???'

      const newWatcher = {
        id: `${chatId}-${url.toString()}`,
        chatId,
        url: url.toString(),
        delay,
        name,
        active: false,
        lastSearchDate: '2000-01-01 00:00:00 GMT+0100'
      }

      if (!chats[chatId]) {
        chats[chatId] = {
          watchers: []
        }
      }

      newWatcher._pid = chats[chatId].watchers.length

      chats[chatId].watchers = [...chats[chatId].watchers, newWatcher]

      Db.save()

      Watcher.start(newWatcher)

      Bot.sendMessage(chatId, formatWatcherInInlineCodeBlock(newWatcher), { parse_mode: 'MarkdownV2' })
    } catch (error) {
      Bot.sendMessage(chatId, error.message)
    }
  })

  // /setname <pid> <name>
  Bot.onText(/^\/setname (\d+) (\w+)/, (msg, match) => {
    const chatId = msg.chat.id
    const pid = Number(match[1])
    const name = match[2]

    const thisChat = chats[chatId]
    if (!thisChat) {
      Bot.sendMessage('ERROR: INVALID REQUEST')
      return
    }
    const thisChatWatchers = thisChat.watchers

    if (pid < 0 || pid >= thisChatWatchers.length || !thisChatWatchers[pid]) {
      Bot.sendMessage(chatId, 'ERROR: INVALID_PID')
      return
    }

    if (!name) {
      Bot.sendMessage(chatId, 'ERROR: INVALID_NAME')
      return
    }

    const watcher = thisChatWatchers[pid]
    watcher.name = name

    Db.save()

    Bot.sendMessage(chatId, formatWatcherInInlineCodeBlock(watcher), { parse_mode: 'MarkdownV2' })
  })

  // /setdelay <pid> <delay>
  Bot.onText(/^\/setdelay (\d+) (\d+)/, (msg, match) => {
    const chatId = msg.chat.id
    const pid = Number(match[1])
    const delay = Number(match[2])

    const thisChat = chats[chatId]
    if (!thisChat) {
      Bot.sendMessage('ERROR: INVALID REQUEST')
      return
    }
    const thisChatWatchers = thisChat.watchers

    if (pid < 0 || pid >= thisChatWatchers.length || !thisChatWatchers[pid]) {
      Bot.sendMessage(chatId, 'ERROR: INVALID_PID')
      return
    }

    if (!Number.isInteger(delay) || delay < 60 || delay > 99999) {
      Bot.sendMessage(chatId, 'ERROR: INVALID_DELAY [60-99999]')
      return
    }

    const watcher = thisChatWatchers[pid]

    watcher.delay = delay

    Db.save()

    Bot.sendMessage(chatId, formatWatcherInInlineCodeBlock(watcher), { parse_mode: 'MarkdownV2' })
  })

  // /stop <pid>
  Bot.onText(/^\/stop (\d+)$/, (msg, match) => {
    const chatId = msg.chat.id
    const pid = Number(match[1])

    const thisChat = chats[chatId]
    if (!thisChat) {
      Bot.sendMessage('ERROR: INVALID REQUEST')
      return
    }
    const thisChatWatchers = thisChat.watchers

    if (pid < 0 || pid >= thisChatWatchers.length || !thisChatWatchers[pid]) {
      Bot.sendMessage(chatId, 'ERROR: INVALID_PID')
      return
    }

    const watcher = thisChatWatchers[pid]

    if (!watcher.active) {
      Bot.sendMessage(chatId, `<${pid}> is already 'stopped'`)
      return
    }

    Watcher.stop(watcher)

    Bot.sendMessage(chatId, formatWatcherInInlineCodeBlock(watcher), { parse_mode: 'MarkdownV2' })
  })

  // /start <pid>
  Bot.onText(/^\/start (\d+)$/, (msg, match) => {
    const chatId = msg.chat.id
    const pid = Number(match[1])

    const thisChat = chats[chatId]
    if (!thisChat) {
      Bot.sendMessage('ERROR: INVALID REQUEST')
      return
    }
    const thisChatWatchers = thisChat.watchers

    if (pid < 0 || pid >= thisChatWatchers.length || !thisChatWatchers[pid]) {
      Bot.sendMessage(chatId, 'ERROR: INVALID_PID')
      return
    }

    const watcher = thisChatWatchers[pid]

    if (watcher.active) {
      Bot.sendMessage(chatId, `<${pid}> is already 'active'`)
      return
    }

    watcher.active = true

    Db.save()

    Watcher.start(watcher)

    Bot.sendMessage(chatId, formatWatcherInInlineCodeBlock(watcher), { parse_mode: 'MarkdownV2' })
  })

  // /del <pid>
  Bot.onText(/^\/del (\d+)$/, (msg, match) => {
    const chatId = msg.chat.id
    const pid = Number(match[1])

    const thisChat = chats[chatId]
    if (!thisChat) {
      Bot.sendMessage('ERROR: INVALID REQUEST')
      return
    }
    const thisChatWatchers = thisChat.watchers

    if (pid < 0 || pid >= thisChatWatchers.length || !thisChatWatchers[pid]) {
      Bot.sendMessage(chatId, 'ERROR: INVALID_PID')
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

      const thisChat = chats[chatId]
      if (!thisChat) {
        Bot.sendMessage('ERROR: INVALID REQUEST')
        return
      }

      const watcher = thisChat.watchers[pid]

      console.log(`[${formatWatcherIdentifier(watcher)}] DELETE, Aborting watcher...`)

      Watcher.delete(watcher, pid)

      Bot.sendMessage(chatId, `<${pid}> Deleted`)
    }
  })
}

module.exports = {
  setupBot
}
