const nodemailer = require('nodemailer')

const Mail = options => {

  const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: options.user,
        pass: options.pass
    }
  })

  return {
    send: params => {
      params.from = `LBC-Watcher <${options.user}>`

      return transporter.sendMail(params)
    }
  }
}

module.exports = Mail
