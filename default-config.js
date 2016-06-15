// Create a config.js with your personnal configuration
// Then 'npm start' command

module.exports = {
    "scrapper": {
        "active": true,
        "delay": 2, // min
        "outputFile": "offers.json",
        "urls": [
            "https://www.leboncoin.fr/...", // url you want to match results
        ]
    },
    "sms": [
        { "send": false, "user": "...", "pass": "" } // 'Free' users only
    ],
    "emails": [
        "user@exemple.com"
    ]
}