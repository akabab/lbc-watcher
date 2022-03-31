'use strict'

const Env = require('./env')
const Db = require('./db')
const Datadome = require('./datadome')
const { wait, formatWatcherIdentifier, getRandomInt } = require('./helpers')

const parseOffer = offer => ({
  id: offer.list_id,
  date: `${offer.index_date} GMT+0100`,
  title: offer.subject,
  description: offer.body,
  price: (offer.price && offer.price[0]) || 'N/A',
  where: offer.location.city,
  link: offer.url,
  image: offer.images.thumb_url
})

const cookiesHandler = async watcher => {
  const page = watcher._page

  const cookiesPopup = await page.$('#didomi-popup')

  if (!cookiesPopup) {
    console.log(`[${formatWatcherIdentifier(watcher)}] Cookies already handled`)
    return
  }

  // Continuer sans accepter
  await page.$('button#didomi-notice-disagree-button').click({ delay: getRandomInt(100, 300) })
  console.log(`[${formatWatcherIdentifier(watcher)}] Cookies refused`)

  // Accepter
  // await page.$('button#didomi-notice-agree-button').click({ delay: getRandomInt(100, 300) })
  // console.log(`[${formatWatcherIdentifier(watcher)}] Cookies accepted`)

  // Button "Personnaliser"
  // await page.$('button#didomi-notice-learn-more-button').click({ delay: getRandomInt(100, 300) })
  // await wait(1000)
  // Button "Tout refuser"
  // await page.$('button[aria-label="Refuser notre traitement des données et fermer"]').click({ delay: getRandomInt(100, 300) })
  // console.log(`[${formatWatcherIdentifier(watcher)}] Cookies refused`)
}

const datadomeHandler = async watcher => {
  console.error(`[${formatWatcherIdentifier(watcher)}] I am a bot...`)

  const page = watcher._page

  const captchaIframeElementHandle = await page.$('iframe[src^="https://geo.captcha-delivery.com/captcha/"')
  const frame = await captchaIframeElementHandle.contentFrame()

  console.log(`[${formatWatcherIdentifier(watcher)}] Datadome solving Geetest...`)
  const tries = await Datadome.solveGeetestCaptcha(page, frame)
  console.log(`[${formatWatcherIdentifier(watcher)}] Datadome solving Geetest succeed after ${tries} tries!`)
}

const watcherHandler = async watcher => {
  const page = watcher._page

  const { bot } = Db.getState()

  if (!watcher.active || watcher._SHOULD_BE_DELETED) {
    console.log(`[${formatWatcherIdentifier(watcher)}] !watcher.active || watcher._SHOULD_BE_DELETED, aborting watcher...`)
    return
  }

  if (watcher._page.isClosed() && watcher.active) {
    console.log(`[${formatWatcherIdentifier(watcher)}] Page may have been closed manually or crashed, restarting watcher...`)
    startWatcher(watcher)
    return
  }

  console.log(`[${formatWatcherIdentifier(watcher)}] New search...`)

  try {
    const options = { waitUntil: 'load' }

    await (page.url() === watcher.url ? page.reload(options) : page.goto(watcher.url, options))

    // PAGE IS FULLY LOADED -- important if iframe

    // Datadome
    const dd = await page.$('meta[content^="https://img.datadome.co/captcha"')

    if (dd) {
      try {
        await datadomeHandler(watcher)
      } catch (error) {
        console.error(`[${formatWatcherIdentifier(watcher)}] Error: ${error.message}, Stoping watcher..`)
        stopWatcher(watcher)
        bot.sendMessage(watcher.chatId, `<${watcher._pid}> They know I'm a bot.. Aborted after too much retries, try to restart it with /start command.`)
        return
      }
      await page.waitForNavigation()
    }

    // Cookies
    await wait(1500)
    await cookiesHandler(watcher)

    await wait(1000)
    const nd = await page.$('script#__NEXT_DATA__')
    const datas = await page.evaluate(nd => nd.innerHTML, nd)
    const offers = JSON.parse(datas)
      .props?.pageProps?.searchData?.ads?.map(parseOffer) || []

    const lastSearchDate = new Date(watcher.lastSearchDate)

    // HANDLE results
    const newOffers = offers
      .filter(o => new Date(o.date) > lastSearchDate)
      .sort((o1, o2) => new Date(o1.date) < new Date(o2.date)) // by date, newest first

    console.log(`[${formatWatcherIdentifier(watcher)}] Found ${newOffers.length} new offers`)

    if (newOffers.length >= 1) {
      watcher.lastSearchDate = newOffers[0].date
      Db.save()
    }

    // TELEGRAM MESSAGES
    if (newOffers.length > 0 && newOffers.length < 5) {
      newOffers.forEach(offer => {
        const newOfferMessage = `🔥<${watcher._pid}> New offer <${watcher.name}>🔥\n\n${offer.date}\n\n${offer.title}\n${offer.price}€\n${offer.where}\n\n${offer.link}`
        bot.sendMessage(watcher.chatId, newOfferMessage)
      })
    } else if (newOffers.length >= 5) {
      bot.sendMessage(watcher.chatId, `${newOffers.length} new offers, go to ${watcher.url}`)
    }

    // reset _retries counter
    watcher._retries = 0

    // New search after random delay (between -10 and 10 seconds)
    const randomSeconds = Math.random() * 20 - 10
    const ms = (watcher.delay + randomSeconds) * 1000

    console.log(`[${formatWatcherIdentifier(watcher)}] Next search in ${ms / 1000} seconds`)
    await wait(ms)

    watcherHandler(watcher)
  } catch (error) {
    console.error(`[${formatWatcherIdentifier(watcher)}] Error: ${error.message}, Retrying..`)

    watcher._retries++

    if (watcher._retries > Env.WATCHER_MAX_RETRIES_BEFORE_ABORT) {
      console.log(`[${formatWatcherIdentifier(watcher)}] Too much retries, aborting watcher...`)
      bot.sendMessage(watcher.chatId, `<${watcher._pid}> Aborted after too much retries, try to restart it with /start command.`)

      stopWatcher(watcher)
      return
    }

    watcherHandler(watcher)
  }
}

const deleteWatcher = async watcher => {
  watcher._SHOULD_BE_DELETED = true // 'just in case'

  await stopWatcher(watcher)

  const { chats } = Db.getState()

  delete chats[watcher.chatId].watchers[watcher._pid]

  Db.save()
  console.log(`[${formatWatcherIdentifier(watcher)}] Deleted.`)
}

const stopWatcher = async watcher => {
  watcher.active = false
  Db.save()

  watcher._page?.close() // This will make eventual current page navigations to fail because page.isClosed()
  // delete watcher._page
  console.log(`[${formatWatcherIdentifier(watcher)}] Stopping. Closing page...`)
}

const startWatcher = async watcher => {
  watcher.active = true
  Db.save()

  // OPEN PAGE (once)
  console.log(`[${formatWatcherIdentifier(watcher)}] Starting. Opening new page...`)

  const { browser } = Db.getState()
  const page = await browser.newPage()

  page.setDefaultTimeout(60 * 1000) // 1 min
  // await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:91.0) Gecko/20100101 Firefox/91.0' })

  // Add a 'ghost' cursor to the page object
  // page.humanclick = createCursor(page) //, await getRandomPagePoint(page), false)
  // await installMouseHelper(page)

  watcher._page = page
  watcher._retries = 0

  watcherHandler(watcher)
}

module.exports = {
  start: startWatcher,
  stop: stopWatcher,
  delete: deleteWatcher
}
