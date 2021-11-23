const axios = require('axios').default
const axiosRetry = require('axios-retry')

axiosRetry(axios, {retries: 1000, retryDelay: () => 1000})

const {NODE_URL, NODE_KEY} = process.env

function api() {
  const instance = axios.create({
    baseURL: NODE_URL,
  })
  instance.interceptors.request.use(function(config) {
    config.data.key = NODE_KEY
    return config
  })
  return instance
}

async function getEpoch() {
  const {data} = await api().post('/', {
    method: 'dna_epoch',
    params: [],
    id: 1,
  })
  const {result, error} = data
  if (error) throw new Error(error.message)
  return result
}

async function getIdentity(address) {
  const {data} = await api().post('/', {
    method: 'dna_identity',
    params: [address],
    id: 1,
  })
  const {result, error} = data
  if (error) throw new Error(error.message)
  return result
}

async function getLastBlock() {
  const {data} = await api().post('/', {
    method: 'bcn_lastBlock',
    params: [],
    id: 1,
  })
  const {result, error} = data
  if (error) throw new Error(error.message)
  return result
}

module.exports = {
  getEpoch,
  getIdentity,
  getLastBlock,
}
