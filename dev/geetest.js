const puppeteer = require('puppeteer')
const fs = require('fs').promises
const Jimp = require('jimp')
const pixelmatch = require('pixelmatch')
const { cv } = require('opencv-wasm')

const findPuzzlePosition = async page => {
  const images = await page.$$eval('.geetest_canvas_img canvas', canvases => canvases.map(canvas => canvas.toDataURL().replace(/^data:image\/png;base64,/, '')))

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

const findDiffPosition = async page => {
  await page.waitFor(100)

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

const saveSliderCaptchaImages = async page => {
  await page.waitForSelector('.tab-item.tab-item-1')
  await page.click('.tab-item.tab-item-1')

  await page.waitForSelector('[aria-label="Click to verify"]')
  await page.waitFor(1000)

  await page.click('[aria-label="Click to verify"]')

  await page.waitForSelector('.geetest_canvas_img canvas', { visible: true })
  await page.waitFor(1000)
  const images = await page.$$eval('.geetest_canvas_img canvas', canvases => {
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
  diffImage.write('./diff.png')
}

const run = async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1366, height: 768 }
  })
  const page = await browser.newPage()

  await page.goto('https://www.geetest.com/en/demo', { waitUntil: 'networkidle2' })

  await page.waitFor(1000)

  await saveSliderCaptchaImages(page)
  await saveDiffImage()

  const [cx/* , cy */] = await findDiffPosition(page)

  const sliderHandle = await page.$('.geetest_slider_button')
  const handle = await sliderHandle.boundingBox()

  let xPosition = handle.x + handle.width / 2
  let yPosition = handle.y + handle.height / 2
  await page.mouse.move(xPosition, yPosition)
  await page.mouse.down()

  xPosition = handle.x + cx - handle.width / 2
  yPosition = handle.y + handle.height / 3
  await page.mouse.move(xPosition, yPosition, { steps: 25 })

  await page.waitFor(100)

  const [cxPuzzle/* , cyPuzzle */] = await findPuzzlePosition(page)

  xPosition = xPosition + cx - cxPuzzle
  yPosition = handle.y + handle.height / 2
  await page.mouse.move(xPosition, yPosition, { steps: 5 })
  await page.mouse.up()

  await page.waitFor(3000)
  // success!

  await fs.unlink('./original.png')
  await fs.unlink('./captcha.png')
  await fs.unlink('./diff.png')
  await fs.unlink('./puzzle.png')

  await browser.close()
}

run()
