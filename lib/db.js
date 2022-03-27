'use strict'

const fsp = require('fs').promises
const Env = require('./env')
const { filterDeletedWatchers } = require('./helpers')

const state = {
  browser: null,
  bot: null,
  chats: {}
}

const getAllWatchers = () => Object.values(state.chats)
  .map(chat => chat.watchers)
  .reduce((prev, current) => [...prev, ...current], [])
  .filter(filterDeletedWatchers)

const prepareContent = () => getAllWatchers()
  .map(watcher => ({
    id: watcher.id,
    chatId: watcher.chatId,
    url: watcher.url,
    delay: watcher.delay,
    name: watcher.name,
    active: watcher.active,
    lastSearchDate: watcher.lastSearchDate
  }))

const G_QUEUES = {}

class Queue {
  constructor () {
    this.queue = []
  }

  async next () {
    if (this.queue.length === 0) { return }

    const [filePath, content] = this.queue[0]
    console.log('Persisting to file...', filePath)

    try {
      // await fsp.truncate(filePath)
      fsp.writeFile(filePath, content + '\n', { encoding: 'utf8' })
        .then(() => {
          console.log('Successfully saved', filePath)
          this.queue.shift()
          this.next()
        })
    } catch (err) {
      console.error('Failed to save to dump file', filePath, err)
    }
  }

  add (...args) {
    this.queue.push(args)
    if (this.queue.length === 1) {
      this.next()
    }
  }
}

const save = async () => {
  const filePath = Env.WATCHER_DUMP_FILE_PATH

  const content = JSON.stringify(prepareContent(), null, 2)

  const queue = G_QUEUES[filePath] || new Queue()

  queue.add(filePath, content)
}

const load = async () => {
  const filePath = Env.WATCHER_DUMP_FILE_PATH

  console.log('Loading dump file...', filePath)
  try {
    const content = await fsp.readFile(filePath)
    const jsonContent = JSON.parse(content)

    const loadedWatchers = jsonContent

    for (const watcher of loadedWatchers) {
      // ASSIGN A PID AND START THE ACTIVE ONES
      watcher._pid = state.chats[watcher.chatId]?.watchers.length || 0

      state.chats[watcher.chatId] = {
        ...(state.chats[watcher.chatId] || {}),
        watchers: [...(state.chats[watcher.chatId]?.watchers || []), watcher]
      }
    }

    console.log('Dump file successfully loaded', filePath)
  } catch (err) {
    /* ignore file missing ENOENT or empty and continue */
    console.error('Dump file', err)
  }
}

module.exports = {
  save,
  load,
  getAllWatchers,
  getState: () => state,
  setStateKeyValue: (key, value) => { state[key] = value }
}
