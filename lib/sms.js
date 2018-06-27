const fetch = require('node-fetch')

// const Bouygues = require("bouygues-sms")
// const sms = new Bouygues("yoann_cribier@hotmail.com", "Bouygues918273!", 1) // 3rd argument is for debug log (1 for enabled, 0 for disabled)

// sms.send("Hello World!", "0781847840", (error) => {
//   if (error) {
//     console.log("An error occured: " + error.code)
//   } else {
//     console.log("success")
//   }
// })

// Free
const STATUS_CODE_MESSAGES = {
  FR: {
    200: "Le SMS a été envoyé sur votre mobile.",
    400: "Un des paramètres obligatoires est manquant.",
    402: "Trop de SMS ont été envoyés en trop peu de temps.",
    403: "Le service n'est pas activé sur l'espace abonné, ou login / clé incorrect.",
    500: "Erreur côté serveur. Veuillez réessayer ultérieurement.",
    default: "Erreur inconnue."
  },
  EN: {
    200: "SMS has been sent successfully.",
    400: "One mandatory parameter is missing.",
    402: "Too many SMS have been sent in a short time period.",
    403: "Service is not activated on this user account or login / password is incorrect.",
    500: "Server error. Please try again later.",
    default: "Unknown error."
  }
}

const handleResponse = (res) => {
  if (res.status !== 200) {
    throw Error(STATUS_CODE_MESSAGES.EN[res.status] || STATUS_CODE_MESSAGES.EN.default)
  }

  return STATUS_CODE_MESSAGES.EN[200]
}

const Sms = options => {
  const baseUrl = 'https://smsapi.free-mobile.fr/sendmsg'
  const preparedUrl = `${baseUrl}?user=${options.user}&pass=${options.pass}`

  return {
    send: message => {
      const url = `${preparedUrl}&msg=${encodeURIComponent(message)}`

      return fetch(url).then(handleResponse)
    }
  }
}

module.exports = Sms
