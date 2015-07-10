// var OCR = require('./lib/OCR');
var Scrapper = require('./lib/Scrapper');
var config = require('./config.js');

Scrapper.recoverOffers();
setInterval(Scrapper.recoverOffers, config.scrapper.delay * 60 * 1000);