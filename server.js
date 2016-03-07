// var OCR = require('./lib/OCR');
var Scrapper = require('./lib/Scrapper');
var config = require('./config.js');

var urls = config.scrapper && config.scrapper.urls;

urls.forEach(function (url) {
	Scrapper.recoverOffers(url);
	setInterval(function () { Scrapper.recoverOffers(url); }, config.scrapper.delay * 60 * 1000);
});

