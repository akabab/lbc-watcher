const cheerio = require('cheerio')
const fetch = require('node-fetch')
const md5 = require('MD5')

const wait = ms => new Promise(s => setTimeout(s, ms))

const recoverOffers = async url => {
  const res = await fetch(url)

  const body = await res.text()
  $ = cheerio.load(body)

  const offerElements = Array.from($('li[data-qa-id="aditem_container"]'))

  const offers = offerElements.map(elem => {

    const offer = {
      title: $(elem).find('a').attr('title'),
      date: $(elem).find('div[itemprop="availabilityStarts"]').text().trim(),
      price: $(elem).find('span[itemprop="price"]').text().trim().replace(/\s/ig, ''),
      link: 'https://www.leboncoin.fr' + $(elem).find('a').attr('href'),
      where: $(elem).find('p[itemprop="availableAtOrFrom"]').text().trim(),
      // image: $(elem).find('.LazyLoad').attr('src') // img is loaded by script
    }

    offer.id = md5(offer.link)

    return offer
  })

  return offers
}

module.exports = {
  recoverOffers
}
