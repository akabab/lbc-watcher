'use strict'

/* https://blog.heroku.com/best-practices-nodejs-errors */
const terminate = (doPromiseBeforeExit, options = { coredump: false, timeout: 3000 }) => {
  // Exit function
  const exit = code => {
    options.coredump ? process.abort() : process.exit(code)
  }

  return (code, reason) => async (err, promise) => {
    console.error(`Terminate`, reason)

    if (err && err instanceof Error) {
      // Log error information, use a proper logging library here :)
      console.error(err.message, err.stack)
    }

    await doPromiseBeforeExit()

    exit(code)
    // setTimeout(exit, options.timeout).unref()
  }
}

module.exports = {
  terminate
}