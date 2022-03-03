const Scrapper = require('./lib/scrapper')
const config = require('./config.js')

const TelegramBot = require('node-telegram-bot-api');

const fs = require('fs')
const path = require('path')

const Sms = require('./lib/sms')
const Mail = require('./lib/mail')

// Create a bot that uses 'polling' to fetch new updates
const { token, chatId } = config.telegram
const Bot = new TelegramBot(token, { polling: true });

const urls = config.scrapper && config.scrapper.urls

// == HELPERS ==

const wait = ms => new Promise(r => setTimeout(r, ms));
const flatMap = arr => arr.reduce((acc, e) => [ ...acc, ...e ], [])
//


let OFFERS = {}

const file = path.join(__dirname, (config.scrapper && config.scrapper.outputFile) || 'offers.json')
try {
  OFFERS = JSON.parse(fs.readFileSync(file))
} catch (e) {
  console.error(e)
}


const filterNewOffers = offers => offers.filter(offer => !Object.keys(OFFERS).includes(offer.id))

const telegramHandler = offers => {
  if (offers.length === 0) {
    console.log('No new offers at the moment');
  }
  else if (offers.length === 1) {
    const o = offers[0]
    Bot.sendMessage(chatId, `
      New offer ${o.title}
      Price: ${o.price}
      Where: ${o.where}
      ${o.link}
    `);
  } else {
    Bot.sendMessage(chatId, `${offers.length} new offers, go to https://www.leboncoin.fr/mes-recherches`);
  }

  return offers
}

const mailHandler = offers => {

  const prepareMailHtml = offers => {
    return offers.map(offer => `
      <div className='offer' style='background-color: gold; margin: 1rem; padding: 1rem;'>
        <h4>${offer.title}</h4>
        <p>${offer.where}</p>
        <p>${offer.date}</p>
        <p>${offer.price}€</p>
        <a href='${offer.link}'>${offer.link}</a>
      </div>
    `).join('')
  }

  Mail(config.mail).send({
    to: config.mail.to.join(', '),
    subject: "[LBC-Watcher] New offers",
    text: "",
    html: prepareMailHtml(offers)
  })

  return offers
}

const save = offers => {
  offers.forEach(offer => OFFERS[offer.id] = offer)

  fs.writeFile(file, JSON.stringify(OFFERS, null, 2), err => {
    if (err) {
      console.error("Failed to saved offers to %s: %s", file, err)
    } else {
      console.log(`${offers.length} new offers saved to %s`, file)
    }
  })

  return offers
}

const loop = offers => {
  Scrapper.end()

  // add some random delay (between 0 and 10 seconds)
  const randomSeconds = Math.random() * 10
  const ms = (config.scrapper.delay * 60 + randomSeconds) * 1000
  console.log(`next run in ${ms / 1000} seconds`)
  setTimeout(run, ms)

  return offers
}

const run = async () => {
  await Scrapper.init()

  return Promise.all(urls.map(Scrapper.recoverOffers))
    .then(flatMap)
    .then(filterNewOffers)
    .then(telegramHandler)
    .then(save)
    .then(loop)
}

run()