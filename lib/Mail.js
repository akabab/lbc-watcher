var nodemailer = require('nodemailer');

var transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: 'akabab.tools@gmail.com',
        pass: '!@#$%^&*('
    }
});

var send = function (options, callback) {
    options.from = 'akabab.tools@gmail.com';

    transporter.sendMail(options, callback);
};

module.exports = {
    send: send
};
