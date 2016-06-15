var cheerio = require('cheerio');
var moment = require('moment');
var request = require('request'); //.defaults({jar: true});

var config = require('../config.js');

var Sms = require('./Sms');

var Mail = require('./Mail');

var md5 = require('MD5');
var fs = require('fs');

var OFFERS = {};
var needSave = false;

var file = (config.scrapper && config.scrapper.outputFile) || 'offers.json';
try {
    OFFERS = JSON.parse(fs.readFileSync(file));
} catch (e) {
    console.error("%s: %s", file, e);
}

var recoverOffers = function (url) {
    var time = moment().format('MMMM Do YYYY, h:mm:ss a');
    console.log(time, '- Recovering Offers for url: ' + url);

    needSave = false;

    request({
        url: url,
        method: "GET"
    }, function (err, xhr, body) {
        if (err) {
            console.error(err);
        } else {
            $ = cheerio.load(body);

            var $elemList = $('.list_item');
            $elemList.each(function () {
                var offer = {
                    title: $(this).attr('title'),
                    date: $(this).find('.item_absolute').text().trim(), //.replace(/\s{2,}/ig, ' - '),
                    price: $(this).find('.item_price').text().trim().replace(/\s/ig, ''),
                    link: $(this).attr('href').substr(2)
                };
                offer._id = md5(offer.link);

                if (!OFFERS[offer._id]) {
                    OFFERS[offer._id] = offer;
                    console.log('offer added:', OFFERS[offer._id]);

					// Emails

                    const emails = config.emails.join(', ');
                    var options = {
                        to: emails,
                        subject: "[LBC-Watcher] - New Offer: " + offer.title,
                        text: "",
                        html: offer.title + ', ' + offer.price + ' -> ' + "<a href='" + offer.link + "'>" + "link</a>"
                    }

                    Mail.send(options, function (error, info){
                        if (error) { return console.log(error); }
                        console.log('Message sent to:', emails, info.response);
                    });

					// SMS
                    const smsConfigs = config.sms;
					if (!process.env["NO_SMS"]) {
						smsConfigs.forEach(function (conf) {
							if (conf.send) {
                    	    	Sms(conf).send('new offer: ' + offer.title + ', ' + offer.price + ' -> ' + offer.link);
                            }
						});
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
