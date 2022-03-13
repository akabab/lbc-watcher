const TelegramBot = require('node-telegram-bot-api')
const Bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true })

const G_WATCHERS = [
  { pid: 0, name: "dewalt", delay: 312, active: true, "url": "https://www.leboncoin.fr/recherche?text=dewalt&locations=r_26&sort=time" },
  { pid: 1, name: "van", delay: 14*3600 + 512, active: false, "url": "https://www.leboncoin.fr/recherche?category=5&text=VAN%20OR%20KANGOO%20OR%20CADDY%20OR%20BERLINGO%20OR%20PARTNER%20OR%20TRAFFIC%20OR%20TRAVELER%20OR%20L1H1&locations=r_26&price=5000-15000&mileage=min-170000&sort=time" },
  { pid: 123, name: "facomORfacoORfalcomORfalcolm", delay: 35*60, active: true, "url": "https://www.leboncoin.fr/recherche?text=scie&locations=r_26&sort=time" },
]

Bot.on('polling_error', error => { console.error(error) })

Bot.on('message', message => {
  console.log('MESSAGE', { message })
})

Bot.onText(/\/md/, message => {
  const chatId = message.chat.id

  const nameMaxLength = 15
  const ellipsis = (s, maxLength = 10) => s.length > maxLength ? s.split('', maxLength - 3).reduce((o, c) => o.length === maxLength - 4 ? `${o}${c}...` : `${o}${c}` , '') : s

  const formatPid = pid => (' '.repeat(3) + pid).slice(-3)
  const formatName = name => (ellipsis(name, nameMaxLength) + ' '.repeat(nameMaxLength)).slice(0, nameMaxLength).replace('...', '\\.\\.\\.')
  const formatDelay = delay => (' '.repeat(6) + (delay >= 3600 ? `>${Math.floor(delay/3600)}h` : `~${Math.round(delay/60)}min`)).slice(-6).replace(/(>|~)/g, '\\$1')
  const formatStatus = active => active ? 'active ' : 'stopped'

  const formatWatcher = w => `| ${formatPid(w.pid)} | ${formatName(w.name)} | ${formatDelay(w.delay)} | ${formatStatus(w.active)} |`

  const header = `| PID | NAME            |  DELAY | STATUS  |`
  const codeBlock = '```'
  const markdown = `${codeBlock}\n${header}\n${G_WATCHERS.map(formatWatcher).join('\n')}${codeBlock}`.replace(/\|/g, '\\|')

  Bot.sendMessage(chatId, markdown, { parse_mode: 'MarkdownV2' })
})

Bot.onText(/\/love/, message => {
  const opts = {
    reply_to_message_id: message.message_id,
    reply_markup: JSON.stringify({
      keyboard: [
        ['Yes, you are the bot of my life ❤'],
        ['No, sorry there is another one...']
      ],
      one_time_keyboard: true,
      selective: true,
      input_field_placeholder: 'Say it you love me ...'
    })
  }

  Bot.sendMessage(message.chat.id, 'Do you love me?', opts)
})

Bot.onText(/\/rm/, message => {
  // TODO REMOVE KEYBOARD on
  const opts = {
    parse_mode: 'Markdown',
    reply_markup: JSON.stringify({
      remove_keyboard: true,
      selective: true
    })
  }

  // DOESN'T WORK IF MESSAGE IS EMPTY
  Bot.sendMessage(message.chat.id, 'RM KEYBOARD', opts)
})

Bot.onText(/\/hello/, message => {
  // define inline keyboard to send to user
  const opts = {
    parse_mode: 'Markdown',
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [
          { text: 'Hello Sir', callback_data: 'hello' },
          { text: 'Hi !! (notif)', callback_data: 'hi1' },
          { text: 'Hi !! (alert)', callback_data: 'hi2' }
        ],
        [
          { text: 'Are you ok ?', callback_data: 'are you ok' }
        ]
      ]
    })
  }

  // reply when user sends a message, and send him our inline keyboard as well
  Bot.sendMessage(message.chat.id, 'Message received', opts)
})

// Because each inline keyboard button has callback data, you can listen for the callback data and do something with them
Bot.on('callback_query', query => {
  if (query.data === 'hello') {
    Bot.sendMessage(query.message.chat.id, 'Hello to you too!')
  } else if (query.data === 'hi1') {
    Bot.answerCallbackQuery(query.id, {
      text: 'Heheh Hey Hey Hey!'
      // show_alert: true
    })
  } else if (query.data === 'hi2') {
    Bot.answerCallbackQuery(query.id, {
      text: 'Heheh Hey Hey Hey!',
      show_alert: true
    })
  }
})

// Matches /editable
Bot.onText(/\/editable/, message => {
  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Edit Text',
            // we shall check for this value when we listen
            // for "callback_query"
            callback_data: 'edit'
          }
        ]
      ]
    }
  }

  Bot.sendMessage(message.from.id, 'Original Text', opts)
})

Bot.on('inline_query', query => {
  console.log({ query })

  const results = JSON.stringify([{
    type: 'article',
    id: 'ec',
    title: 'Edison Chee on Medium',
    description: 'UX Research. UI Design. Web Development',
    thumb_url: 'http://edisonchee.com/img/favicon.ico',
    input_message_content: {
      message_text: 'Featured article: [Rethinking top-level navigation labels](https://blog.gds-gov.tech/rethinking-top-level-navigation-labels-75c9759613af#.ke516y2qw)',
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    }
  }, {
    type: 'article',
    id: 'gt',
    title: 'Singapore GovTech Blog',
    description: 'Be Happy, Be Awesome!',
    thumb_url: 'https://cdn-images-1.medium.com/max/82/1*hB4KIovectkFlSXV3NhHUQ.png',
    input_message_content: {
      message_text: 'View all posts: [GovTech Blog](https://blog.gds-gov.tech/)',
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    }
  }])

  Bot.answerInlineQuery(query.id, results)
})
