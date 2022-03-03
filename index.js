const fs = require('fs').promises
const path = require('path')

const Scrapper = require('./lib/scrapper')
const TelegramBot = require('node-telegram-bot-api')
// const Mail = require('./lib/mail')
// const Sms = require('./lib/sms')

require('dotenv').config()

const ENV = {
  WATCHER_SAVE_TO_FILE_PATH: path.join(__dirname, process.env.WATCHER_SAVE_TO_FILE_PATH || 'offers.json'),
  WATCHER_DELAY_IN_MINUTES: Number(process.env.WATCHER_DELAY_IN_MINUTES),
  WATCHER_URLS: process.env.WATCHER_URLS?.split(' ') || [],
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID: Number(process.env.TELEGRAM_CHAT_ID),
  SMS_FREE_USER: process.env.SMS_FREE_USER,
  SMS_FREE_PASS: process.env.SMS_FREE_PASS,
  MAIL_GMAIL_USER: process.env.MAIL_GMAIL_USER,
  MAIL_GMAIL_PASS: process.env.MAIL_GMAIL_PASS,
  MAIL_SEND_TO: process.env.MAIL_SEND_TO?.split(' ') || [],
}

console.log(ENV)

const Bot = new TelegramBot(ENV.TELEGRAM_TOKEN, { polling: true })

// == HELPERS ==
const wait = ms => new Promise(r => setTimeout(r, ms))
const flatMap = arr => arr.reduce((acc, e) => [ ...acc, ...e ], [])

// load OFFERS
let G_OFFERS = {};
(async () => {
  try {
    const content = await fs.readFile(ENV.WATCHER_SAVE_TO_FILE_PATH)
    G_OFFERS = JSON.parse(content)
  } catch { /* ignore file missing ENOENT and continue */ }
})();


const filterNewOffers = offers => offers.filter(offer => !Object.keys(G_OFFERS).includes(offer.id))

const telegramHandler = offers => {
  if (offers.length === 0) {
    console.log('No new offers at the moment')
  }
  else if (offers.length === 1) {
    const o = offers[0]
    Bot.sendMessage(ENV.TELEGRAM_CHAT_ID, `
      New offer ${o.title}
      Price: ${o.price}
      Where: ${o.where}
      ${o.link}
    `)
  } else {
    Bot.sendMessage(ENV.TELEGRAM_CHAT_ID, `${offers.length} new offers, go to https://www.leboncoin.fr/mes-recherches`)
  }

  return offers
}

const mailHandler = offers => {

  const prepareMailHtml = offers => {
    return offers.map(offer => `
      <div className='offer' style='background-color: gold margin: 1rem padding: 1rem'>
        <h4>${offer.title}</h4>
        <p>${offer.where}</p>
        <p>${offer.date}</p>
        <p>${offer.price}€</p>
        <a href='${offer.link}'>${offer.link}</a>
      </div>
    `).join('')
  }

  const options = {
    user: ENV.MAIL_GMAIL_USER,
    pass: ENV.MAIL_GMAIL_PASS,
  }

  const to = ENV.MAIL_SEND_TO.join(', ')

  Mail(options).send({
    to,
    subject: "[LBC-Watcher] New offers",
    text: "",
    html: prepareMailHtml(offers)
  })

  return offers
}

const save = async offers => {
  offers.forEach(offer => G_OFFERS[offer.id] = offer)

  const filePath = ENV.WATCHER_SAVE_TO_FILE_PATH

  try {
    /* await */ fs.writeFile(filePath, JSON.stringify(G_OFFERS, null, 2))
    console.log(`${offers.length} new offers saved to %s`, filePath)
  } catch (err) {
    console.error("Failed to saved offers to %s: %s", filePath, err)
  }

  return offers
}

const loop = offers => {
  // close browser
  Scrapper.end()

  // add some random delay (between 0 and 10 seconds)
  const randomSeconds = Math.random() * 10
  const ms = (ENV.WATCHER_DELAY_IN_MINUTES * 60 + randomSeconds) * 1000

  // restart watcher
  console.log(`next run in ${ms / 1000} seconds`)
  setTimeout(run, ms)

  return offers
}

const run = async () => {
  await Scrapper.init()

  return Promise.all(ENV.WATCHER_URLS.map(Scrapper.recoverOffers))
    .then(flatMap)
    .then(filterNewOffers)
    .then(telegramHandler)
    .then(save)
    .then(loop)
}

run()