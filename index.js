const { recoverOffers } = require('./lib/scrapper')
const config = require('./config.js')

const fs = require('fs')
const path = require('path')
const moment = require('moment')

const Sms = require('./lib/sms')
const Mail = require('./lib/mail')

let OFFERS = {}

const file = path.join(__dirname, (config.scrapper && config.scrapper.outputFile) || 'offers.json')
try {
  OFFERS = JSON.parse(fs.readFileSync(file))
} catch (e) {
  console.error(e)
}

const flatMap = arr => arr.reduce((acc, e) => [ ...acc, ...e ], [])

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

const urls = config.scrapper && config.scrapper.urls

const run = () => {
  const now = moment().format('MMMM Do YYYY, h:mm:ss a')
  console.log(`${now} - Recovering Offers for urls: ${urls.join(' & ')}`)

  return Promise.all(urls.map(recoverOffers))
  .then(flatMap)
  .then(offers => {
    const newOffers = offers.filter(offer => !Object.keys(OFFERS).includes(offer.id))

    if (newOffers.length === 0) { console.log('none'); return }

    newOffers.forEach(offer => OFFERS[offer.id] = offer)

    fs.writeFile(file, JSON.stringify(OFFERS, null, 2), err => {
      if (err) {
        console.error("Failed to saved offers to %s: %s", file, err)
      } else {
        console.log(`${newOffers.length} new offers saved to %s`, file)
      }
    })

    return Mail(config.mail).send({
      to: config.mail.to.join(', '),
      subject: "[LBC-Watcher] New offers",
      text: "",
      html: prepareMailHtml(newOffers)
    })
  })
}

setInterval(run, config.scrapper.delay * 60 * 1000)
run().then(() => console.log('all good'), console.error)
