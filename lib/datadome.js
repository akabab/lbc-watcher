'use strict'

const fsp = require('fs').promises
const Jimp = require('jimp')
const pixelmatch = require('pixelmatch')
const { cv } = require('opencv-wasm')

const findPuzzlePosition = async frame => {
  const images = await frame.$$eval('.geetest_canvas_img canvas', canvases => canvases.map(canvas => canvas.toDataURL().replace(/^data:image\/png;base64,/, '')))

  await fsp.writeFile('./puzzle.png', images[1], 'base64')
  if (process.env.DEBUG) { console.log('DONE WRITTING puzzle') }

  await frame.waitForTimeout(100)

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

  const cx = Math.floor(moment.m10 / moment.m00) || 0
  const cy = Math.floor(moment.m01 / moment.m00) || 0

  return [cx, cy]
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

  const cx = Math.floor(moment.m10 / moment.m00) || 0 // /!\ sometimes moments are nulls, solving might fail
  const cy = Math.floor(moment.m01 / moment.m00) || 0

  return [cx, cy]
}

const saveSliderCaptchaImages = async frame => {
  await frame.waitForSelector('.geetest_canvas_img canvas', { visible: true }) // TODO: detect after refresh
  const images = await frame.$$eval('.geetest_canvas_img canvas', canvases => {
    return canvases.map(canvas => canvas.toDataURL().replace(/^data:image\/png;base64,/, ''))
  })

  await Promise.all([
    fsp.writeFile('./captcha.png', images[0], 'base64'),
    fsp.writeFile('./original.png', images[2], 'base64')
  ])

  if (process.env.DEBUG) { console.log('DONE WRITTING captcha & original') }
}

const saveDiffImage = async () => {
  const [originalImage, captchaImage] = await Promise.all([
    Jimp.read('./original.png'),
    Jimp.read('./captcha.png')
  ])

  const { width, height } = originalImage.bitmap
  const diffImage = new Jimp(width, height)

  const diffOptions = { includeAA: true, threshold: 0.2 }

  pixelmatch(originalImage.bitmap.data, captchaImage.bitmap.data, diffImage.bitmap.data, width, height, diffOptions)
  await diffImage.writeAsync('./diff.png')
  if (process.env.DEBUG) { console.log('DONE WRITTING diff') }
}

const moveSlider = async (page, frame, shouldMakeItFail = false) => {
  const [cx/* , cy */] = await findDiffPosition()

  const sliderElementHandle = await frame.$('.geetest_slider_button')
  const slider = await sliderElementHandle.boundingBox()

  // Positionnate mouse
  let xPosition = slider.x + slider.width / 2
  let yPosition = slider.y + slider.height / 2
  await page.mouse.move(xPosition, yPosition)
  await page.mouse.down()

  await frame.waitForTimeout(100)

  // Slide in 2 phases
  xPosition = slider.x + cx - slider.width / 2
  yPosition = slider.y + slider.height / 3
  await page.mouse.move(xPosition, yPosition, { steps: 25 })

  await frame.waitForTimeout(100)

  const [cxPuzzle/* , cyPuzzle */] = await findPuzzlePosition(frame)

  xPosition = xPosition + cx - cxPuzzle
  yPosition = slider.y + slider.height / 2

  if (process.env.DEBUG) { console.log('before', { xPosition }) }

  if (shouldMakeItFail) { xPosition += 20 }

  if (process.env.DEBUG) { console.log('after', { xPosition }) }

  await page.mouse.move(xPosition, yPosition, { steps: 5 })
  await page.mouse.up()
}

const cleanBeforeReturn = async () => {
  const files = [
    './original.png',
    './captcha.png',
    './diff.png',
    './puzzle.png'
  ]

  return Promise.all(files.map(fsp.unlink))
    .catch(error => console.error(error.message)) /* display error but ignore it */
}

const getState = async frame => {
  const geetestHolderElementHandle = await frame.waitForSelector('.geetest_holder')
  const classNameJsHandle = await geetestHolderElementHandle.getProperty('className')
  const className = await classNameJsHandle.jsonValue()

  return className.split(' ')[2]
}

const solve = async (page, frame, shouldMakeItFail = false) => {
  // Wait for main geetest button to appear
  const state = await getState(frame)

  await frame.waitForTimeout(3000) // this is important

  if (process.env.DEBUG) { console.log({ state }) }

  switch (state) {
    // initial state -> click on 'click to verify' button
    case 'geetest_ready':
    case 'geetest_detect': // mouse as been detected
    case 'geetest_wait_compute': // mouse is hovering button
    case 'geetest_radar_click_hide': { // canvas is ready but hidden
      const clickToVerifyElementHandle = await frame.$('.geetest_radar_tip')
      await clickToVerifyElementHandle.click()
      break
    }

    // geetest canvas is ready and already visible, probably after a failed try -> refresh canvas image
    case 'geetest_radar_click_ready': {
      const refreshElementHandle = await frame.$('.geetest_refresh_1')
      await refreshElementHandle.click()
      await frame.waitForTimeout(1500) // Important to let new canvas update

      // Error after refresh ?
      const state = await getState(frame)
      if (state === 'geetest_radar_error') {
        return false
      }
      break
    }

    // some error occured, probably too many failed retries -> click on reset button
    case 'geetest_radar_error': {
      const resetElementHandle = await frame.$('.geetest_reset_tip_content')
      await resetElementHandle.click()
      break
    }

    // geetest already successful -> return true
    case 'geetest_radar_success': {
      return true
    }

    default: {
      console.error(new Error('Datadome state case not handle'), { state })
      return false
    }
  }

  await frame.waitForTimeout(1000)

  await saveSliderCaptchaImages(frame)
  await saveDiffImage()

  await frame.waitForTimeout(1000)

  await moveSlider(page, frame, shouldMakeItFail)

  // Will throw if success popup not appearing
  await frame.waitForSelector('.geetest_holder.geetest_radar_success', { timeout: 3000 })

  return true
}

const solveGeetestCaptcha = async (page, frame, afterNthTry = 1) => {
  let MAKE_IT_FAIL = true

  let tries = 0
  const maxTries = afterNthTry + 10

  while (tries++ < maxTries) {
    if (tries >= afterNthTry) {
      MAKE_IT_FAIL = false
    }
    if (process.env.DEBUG) { console.log(`Try ${tries}, will ${MAKE_IT_FAIL ? 'fail' : 'succeed'}`) }

    try {
      if (await solve(page, frame, MAKE_IT_FAIL)) {
        await cleanBeforeReturn()
        return tries
      }
    } catch (error) {
      // if throw, continue -> retry
      if (process.env.DEBUG) { console.error(error) }
    }
  }

  await cleanBeforeReturn()

  throw new Error(`Failed to resolve geetest Captcha, after ${tries} tries`)
}

module.exports = {
  solveGeetestCaptcha
}
