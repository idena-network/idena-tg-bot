const {v4: uuidv4} = require('uuid')
const express = require('express')
const bodyParser = require('body-parser')
const {createSession, getSession, updateSession} = require('./fauna')
const {checkSignature} = require('./utils')

const app = express()
app.use(bodyParser.json())
const port = parseInt(process.env.WEBSERVER_PORT)

app.use(function(err, req, res, next) {
  console.error(err.stack)
  res.status(500).send('Something broke!')
})

function startWebServer(onAuth) {
  app.post('/signin/nonce', async (req, res) => {
    try {
      const {token, address} = req.body
      const nonce = `signin-${uuidv4()}`
      await createSession(token, address, nonce)
      res.json({success: true, data: {nonce}})
    } catch (e) {
      res.json({success: false, error: 'Something went wrong'})
    }
  })

  app.post('/signin/auth', async (req, res) => {
    try {
      const {token, signature} = req.body

      const session = await getSession(token)

      const address = checkSignature(session.data.nonce, signature)

      if (address.toLowerCase() !== session.data.address.toLowerCase()) {
        throw new Error('address missmatch')
      }

      await updateSession(session.ref)

      res.json({
        success: true,
        data: {
          authenticated: true,
        },
      })

      onAuth(token)
    } catch (e) {
      res.json({success: false, error: 'Something went wrong'})
    }
  })

  return app.listen(port, () => {
    console.log(`Idena tg bot listening at http://localhost:${port}`)
  })
}

module.exports = {
  startWebServer,
}
