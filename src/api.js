const axios = require('axios').default
const axiosRetry = require('axios-retry')

axiosRetry(axios, {retries: 1000, retryDelay: () => 1000})

const API_URL = 'https://api.idena.io/api'

async function getEpoch() {
  try {
    const {
      data: {result},
    } = await axios.create({baseURL: API_URL}).get('/epoch/last')

    return result
  } catch (e) {
    console.error(e)
    throw new Error('cannot load epoch')
  }
}

async function getIdentity(address) {
  try {
    const {
      data: {result},
    } = await axios.create({baseURL: API_URL}).get(`/identity/${address}`)

    return result
  } catch (e) {
    throw new Error('cannot load identity')
  }
}

module.exports = {
  getEpoch,
  getIdentity,
}
