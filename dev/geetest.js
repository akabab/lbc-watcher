const puppeteer = require('puppeteer')
const fs = require('fs').promises
const Jimp = require('jimp')
const pixelmatch = require('pixelmatch')
const { cv } = require('opencv-wasm')

let FAKE_OFFSET = -10

const findPuzzlePosition = async frame => {
  const images = await frame.$$eval('.geetest_canvas_img canvas', canvases => canvases.map(canvas => canvas.toDataURL().replace(/^data:image\/png;base64,/, '')))

  await fs.writeFile('./puzzle.png', images[1], 'base64')

  const srcPuzzleImage = await Jimp.read('./puzzle.png')
  const srcPuzzle = cv.matFromImageData(srcPuzzleImage.bitmap)
  const dstPuzzle = new cv.Mat()

  cv.cvtColor(srcPuzzle, srcPuzzle, cv.COLOR_BGR2GRAY)
  cv.threshold(srcPuzzle, dstPuzzle, 127, 255, cv.THRESH_BINARY)

  const kernel = cv.Mat.ones(5, 5, cv.CV_8UC1)
  const anchor = new cv.Point(-1, -1)
  cv.dilate(dstPuzzle, dstPuzzle, kernel, anchor, 1)
  cv.erode(dstPuzzle, dstPuzzle, kernel, anchor, 1)

  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  cv.findContours(dstPuzzle, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

  const contour = contours.get(0)
  const moment = cv.moments(contour)

  return [Math.floor(moment.m10 / moment.m00), Math.floor(moment.m01 / moment.m00)]
}

const findDiffPosition = async () => {
  const srcImage = await Jimp.read('./diff.png')
  const src = cv.matFromImageData(srcImage.bitmap)

  const dst = new cv.Mat()
  const kernel = cv.Mat.ones(5, 5, cv.CV_8UC1)
  const anchor = new cv.Point(-1, -1)

  cv.threshold(src, dst, 127, 255, cv.THRESH_BINARY)
  cv.erode(dst, dst, kernel, anchor, 1)
  cv.dilate(dst, dst, kernel, anchor, 1)
  cv.erode(dst, dst, kernel, anchor, 1)
  cv.dilate(dst, dst, kernel, anchor, 1)

  cv.cvtColor(dst, dst, cv.COLOR_BGR2GRAY)
  cv.threshold(dst, dst, 150, 255, cv.THRESH_BINARY_INV)

  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  cv.findContours(dst, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

  const contour = contours.get(0)
  const moment = cv.moments(contour)

  return [Math.floor(moment.m10 / moment.m00), Math.floor(moment.m01 / moment.m00)]
}

const saveSliderCaptchaImages = async frame => {
  await frame.waitForSelector('.geetest_canvas_img canvas', { visible: true })
  await frame.waitForTimeout(1000)
  const images = await frame.$$eval('.geetest_canvas_img canvas', canvases => {
    return canvases.map(canvas => canvas.toDataURL().replace(/^data:image\/png;base64,/, ''))
  })

  await fs.writeFile('./captcha.png', images[0], 'base64')
  await fs.writeFile('./original.png', images[2], 'base64')
}

const saveDiffImage = async () => {
  const originalImage = await Jimp.read('./original.png')
  const captchaImage = await Jimp.read('./captcha.png')

  const { width, height } = originalImage.bitmap
  const diffImage = new Jimp(width, height)

  const diffOptions = { includeAA: true, threshold: 0.2 }

  pixelmatch(originalImage.bitmap.data, captchaImage.bitmap.data, diffImage.bitmap.data, width, height, diffOptions)
  await diffImage.write('./diff.png')
}

const unlinkFiles = async () => {
  await fs.unlink('./original.png')
  await fs.unlink('./captcha.png')
  await fs.unlink('./diff.png')
  await fs.unlink('./puzzle.png')
}

const solveCaptcha = async (page, frame) => {
  await saveSliderCaptchaImages(frame)
  await saveDiffImage()

  await frame.waitForTimeout(200) // else file isn't save

  const [cx/* , cy */] = await findDiffPosition()

  if (cx === NaN) { cx = 0 } // /!\ sometimes it happens -- resolve will fail

  const sliderHandle = await frame.$('.geetest_slider_button')
  const handle = await sliderHandle.boundingBox()

  let xPosition = handle.x + handle.width / 2
  let yPosition = handle.y + handle.height / 2
  await page.mouse.move(xPosition, yPosition)
  await page.mouse.down()

  xPosition = handle.x + cx - handle.width / 2
  yPosition = handle.y + handle.height / 3
  await page.mouse.move(xPosition, yPosition, { steps: 25 })

  await frame.waitForTimeout(100)

  const [cxPuzzle/* , cyPuzzle */] = await findPuzzlePosition(frame)

  xPosition = xPosition + cx - cxPuzzle + (FAKE_OFFSET)
  yPosition = handle.y + handle.height / 2
  await page.mouse.move(xPosition, yPosition, { steps: 5 })
  await page.mouse.up()

  // Will throw if success popup not appearing
  try {
    await frame.waitForSelector('.geetest_ghost_success.geetest_success_animate', { timeout: 3000 })
    await unlinkFiles()
    return true
  } catch (e) {
    await unlinkFiles()
    return false
  }
}

const datadomeHandler = async page => {
  const captchaIframeElementHandle = await page.$('iframe[src^="https://geo.captcha-delivery.com/captcha/"')
  const frame = await captchaIframeElementHandle.contentFrame()

  await frame.waitForSelector('.geetest_radar_tip')

  await frame.waitForTimeout(1000)

  const radarElementHandle = await frame.$('.geetest_radar_tip') //[aria-label="Incomplet"]')

  const radarAriaLabelValue = await frame.evaluate(radar => radar.getAttribute('aria-label'), radarElementHandle)

  if (radarAriaLabelValue === "Cliquer pour vérifier") { // "Incomplet -> image canvas already opened"
    await radarElementHandle.click()
  }

  let tries = 0
  const maxTries = 5
  while (tries < maxTries) {
    if (await solveCaptcha(page, frame)) {
      console.log(`Succeed in ${tries} tries`)
      return
    }

    await frame.waitForTimeout(1500)
    const refreshElementHandle = await frame.$('.geetest_refresh_1')
    await refreshElementHandle.click()
    console.log('retry')
    await frame.waitForTimeout(1500)
    FAKE_OFFSET += 5
    tries++
  }

  console.log(`Failed after ${tries} tries`)
}

const run = async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null, //{ width: 1920, height: 768 },
    args: [
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  })
  const page = await browser.newPage()

  await page.goto('https://www.leboncoin.fr')

  const dd = await page.$('meta[content^="https://img.datadome.co/captcha"')

  if (dd) {
    try {
      await datadomeHandler(page)
    } catch (e) {
      // Handle dd failed to resolve captcha
      console.error(e)
    }
  }

  console.log('DONE')

  await browser.close()
}

run()
