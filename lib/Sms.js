var request = require('request');

var freeApiCallback = (function () {
    var freeErrors = {
        200: "Le SMS a été envoyé sur votre mobile.",
        400: "Un des paramètres obligatoires est manquant.",
        402: "Trop de SMS ont été envoyés en trop peu de temps.",
        403: "Le service n'est pas activé sur l'espace abonné, ou login / clé incorrect.",
        500: "Erreur côté serveur. Veuillez réessayer ultérieurement."
    };

    return function (errorCode, callback) {
        var errorMsg = (freeErrors[errorCode] || 'Erreur iconnue.');
        if (typeof callback === 'function') {
            callback({
                status: errorCode,
                msg: errorMsg
            });
        } else {
            console.log('status:', errorCode);
            console.log('msg:', errorMsg);
        }
    }
})();

module.exports = function (conf) {
    var baseUrl = 'https://smsapi.free-mobile.fr/sendmsg';
    baseUrl += '?user=' + conf.user + '&pass=' + conf.pass + '&msg=';
    return {
        send: function (msg, callback) {
            request.get({
                rejectUnauthorized: false,
                url: baseUrl + encodeURIComponent(msg)
            }, function (err, res, body) {
            if (err) {
                return console.log('error:', err);
            }
            freeApiCallback(res.statusCode, callback);
        });
        }
    };
}