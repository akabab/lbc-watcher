'use strict'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

const nameMaxLength = 15
const ellipsis = (s, maxLength = 10) => s.length > maxLength ? s.split('', maxLength - 3).reduce((o, c) => o.length === maxLength - 4 ? `${o}${c}...` : `${o}${c}`, '') : s

const formatPid = pid => (' '.repeat(3) + pid).slice(-3)
const formatName = name => (ellipsis(name, nameMaxLength) + ' '.repeat(nameMaxLength)).slice(0, nameMaxLength)
const formatDelay = delay => (' '.repeat(6) + (delay >= 3600 ? `>${Math.floor(delay / 3600)}h` : `~${Math.round(delay / 60)}min`)).slice(-6)
const formatStatus = active => active ? 'active ' : 'stopped'

const formatWatcherIdentifier = w => `${w.chatId}-<${formatPid(w._pid)}>-${formatName(w.name)}`

const filterDeletedWatchers = watcher => watcher && !watcher._SHOULD_BE_DELETED

module.exports = {
  wait,
  getRandomInt,
  formatPid,
  formatName,
  formatDelay,
  formatStatus,
  formatWatcherIdentifier,
  filterDeletedWatchers
}
