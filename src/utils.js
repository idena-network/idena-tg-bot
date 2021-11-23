const dayjs = require('dayjs')
const {bufferToHex, ecrecover, fromRpcSig, keccak256, pubToAddress} = require('ethereumjs-util')
const utc = require('dayjs/plugin/utc')
const Notifications = require('../public/notifications.json')
const {IdentityStatus} = require('./types')

dayjs.extend(utc)

function GenerateDnaUrl(token) {
  return `https://app.idena.io/dna/signin/v1?callback_url=${encodeURIComponent(
    process.env.SIGNIN_CALLBACK
  )}&token=${token}&nonce_endpoint=${encodeURIComponent(
    process.env.SIGNIN_NONCE_ENDPOINT
  )}&authentication_endpoint=${encodeURIComponent(process.env.SIGNIN_AUTH_ENDPOINT)}&favicon_url=${encodeURIComponent(
    'https://www.idena.io/favicon.ico'
  )}`
}

function checkSignature(nonce, signature) {
  const nonceHash = keccak256(keccak256(Buffer.from(nonce, 'utf-8')))
  const {v, r, s} = fromRpcSig(signature)
  const pubKey = ecrecover(nonceHash, v, r, s)
  const addrBuf = pubToAddress(pubKey)
  const addr = bufferToHex(addrBuf)
  return addr
}

function escape(str) {
  return str.replace(/[!-.+?^$[\](){}\\]/g, '\\$&')
}

function getIdentityMessage(obj, identity) {
  if (!obj) return null
  switch (identity.state) {
    case IdentityStatus.Undefined:
      return obj.default
    case IdentityStatus.Invite:
      return obj.invite
    case IdentityStatus.Candidate:
    case IdentityStatus.Suspended:
    case IdentityStatus.Zombie:
      return obj.candidate
    case IdentityStatus.Newbie:
      return obj[`newbie-${identity.age}`] || obj.newbie
    case IdentityStatus.Verified:
      return obj[`verified-${identity.age}`] || obj.verified
    case IdentityStatus.Human:
      return obj[`human-${identity.age}`] || obj.human
    default:
      return null
  }
}

function getNotification(...args) {
  return identity =>
    getIdentityMessage(
      args.reduce((p, c) => (p && p[c]) || null, Notifications),
      identity
    )
}

function getPercentDateByEpoch(startBlock, nextValidation, currentBlock, currentBlockTimestamp, percent) {
  const blocksUntilValidation = dayjs(nextValidation).diff(dayjs(currentBlockTimestamp * 1000), 'minute') * 3
  const validationBlock = currentBlock + blocksUntilValidation
  const epochDurationInBlocks = validationBlock - startBlock
  return dayjs(nextValidation).subtract((epochDurationInBlocks * (1 - percent)) / 3, 'minute')
}

function log(message) {
  console.log(`${new Date().toISOString()} - ${message}`)
}

function logError(message) {
  console.error(`${new Date().toISOString()} - ${message}`)
}

function buildNextValidationCalendarLink(nextValidation) {
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&dates=${dayjs(nextValidation).format(
    'YYYYMMDDTHHmmssZ'
  )}%2F${dayjs(nextValidation)
    .add(30, 'minute')
    .format(
      'YYYYMMDDTHHmmssZ'
    )}&details=Plan%20your%20time%20in%20advance%20to%20take%20part%20in%20the%20validation%20ceremony%21%20Before%20the%20ceremony%2C%20read%20our%20explainer%20of%20how%20to%20get%20validated%3A%20https%3A%2F%2Fmedium.com%2Fidena%2Fhow-to-pass-a-validation-session-in-idena-1724a0203e81&text=Idena%20Validation%20Ceremony`
}

function adjustDateToValidationTime(date) {
  const dt = dayjs(date)

  return dayjs(Date.UTC(dt.get('year'), dt.get('month'), dt.get('date'), 13, 30, 0, 0))
}

module.exports = {
  GenerateDnaUrl,
  checkSignature,
  escape,
  getNotification,
  getPercentDateByEpoch,
  log,
  logError,
  buildNextValidationCalendarLink,
  adjustDateToValidationTime,
}
