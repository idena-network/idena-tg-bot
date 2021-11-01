const {bufferToHex, ecrecover, fromRpcSig, keccak256, pubToAddress} = require('ethereumjs-util')

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
  return str.replace(/[-.+?^$[\](){}\\]/g, '\\$&')
}

module.exports = {
  GenerateDnaUrl,
  checkSignature,
  escape,
}
