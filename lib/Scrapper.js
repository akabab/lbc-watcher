var cheerio = require('cheerio');
var moment = require('moment');
var request = require('request'); //.defaults({jar: true});

var config = require('../config.js');

var Sms = require('./Sms')({user: config.sms.user, pass: config.sms.pass});

var md5 = require('MD5');
var fs = require('fs');

var OFFERS = {};
var needSave = false;

var file = 'offers.json';
try {
    OFFERS = JSON.parse(fs.readFileSync(file));
} catch (e) {
    console.error("%s: %s", file, e);
}

var recoverOffers = function (url) {
    var t = moment().format('MMMM Do YYYY, h:mm:ss a');
    console.log('Recovering Offers...', t);

    needSave = false;

    request({
        url: url,
        method: "GET"
    }, function (err, xhr, body) {
        if (err) {
            console.error(err);
        } else {
            $ = cheerio.load(body);

            var $elemList = $('.list-lbc a');
            $elemList.each(function () {
                var offer = {
                    title: $(this).attr('title'),
                    date: $(this).find('.date').text().trim().replace(/\s{2,}/ig, ' - '),
                    price: $(this).find('.price').text().trim().replace(/\s/ig, ''),
                    link: $(this).attr('href')
                };
                offer._id = md5(offer.link);

                if (!OFFERS[offer._id]) {
                    OFFERS[offer._id] = offer;
                    console.log('offer added:', OFFERS[offer._id]);
                    if (!process.env["SMS"] && config.sms.send) {
                        Sms.send('new offer: ' + offer.title + ', ' + offer.price + ' -> ' + offer.link);
                    }
                    needSave = true;
                } else {
                    // console.log('offer already exists:', offer._id);
                }
            });

            if (needSave) {
                fs.writeFile(file, JSON.stringify(OFFERS, null, 4), function (err) {
                    if (err) {
                        console.error("Failed to saved offers to %s: %s", file, err);
                    } else {
                        console.log("Offers saved to %s", file);
                    }
                });
            }
        }
    });
};

module.exports = {
    recoverOffers: recoverOffers
};
