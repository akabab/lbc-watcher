// Create a config.js with your personnal configuration
// Then 'npm start' command

module.exports = {
  "scrapper": {
    "active": true,
    "delay": 2, // min
    "outputFile": "offers.json",
    "urls": [
      "https://www.leboncoin.fr/recherche/..."
    ]
  },
  "sms": { user: "USER", "pass": "PASS" }, // FREE USERS
  "mail": {
    user: 'GMAIL_USER',
    pass: 'GMAIL_PASS',
    to: [
      'TO_MAIL'
    ]
  },
  "telegram": {
    "token": "TELEGRAM_TOKEN", // from @BotFather chat
    "chatId": "TELEGRAM_CHAT_ID" // integer
  }
}
