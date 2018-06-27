const { recoverOffers } = require('./scrapper.js')

recoverOffers('https://www.leboncoin.fr/recherche/?text=mercedes%2040*&category=4&price=750-10000')
  .then(console.log, console.error)
