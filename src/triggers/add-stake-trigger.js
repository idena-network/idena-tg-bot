const axios = require('axios').default
const dayjs = require('dayjs')
const EventEmitter = require('events')
const {isTriggerDone, persistTrigger} = require('../fauna')
const {IdentityStatus} = require('../types')
const {getNotification, logError, log, escape} = require('../utils')

const ID = 'add-stake'

function calcPercent(age) {
  switch (age) {
    case 5:
      return 5
    case 6:
      return 4
    case 7:
      return 3
    case 8:
      return 2
    case 9:
      return 1
    default:
      return 100
  }
}

function calcReward(stake, apiData) {
  const {weight, averageMinerWeight, validation, staking, onlineMinersCount} = apiData

  // epoch staking
  const epochStakingRewardFund = Number(staking) || 0.9 * Number(validation)
  const epochReward = (stake ** 0.9 / weight) * epochStakingRewardFund

  const myStakeWeight = stake ** 0.9

  const proposerOnlyReward = (6 * myStakeWeight * 20) / (myStakeWeight * 20 + averageMinerWeight * 100)

  const committeeOnlyReward = (6 * myStakeWeight) / (myStakeWeight + averageMinerWeight * 119)

  const proposerAndCommitteeReward = (6 * myStakeWeight * 21) / (myStakeWeight * 21 + averageMinerWeight * 99)

  const proposerProbability = 1 / onlineMinersCount

  const committeeProbability = Math.min(100, onlineMinersCount) / onlineMinersCount

  const proposerOnlyProbability = proposerProbability * (1 - committeeProbability)

  const committeeOnlyProbability = committeeProbability * (1 - proposerProbability)

  const proposerAndCommitteeProbability = proposerOnlyProbability * committeeOnlyProbability

  const estimatedReward =
    85000 *
    (proposerOnlyProbability * proposerOnlyReward +
      committeeOnlyProbability * committeeOnlyReward +
      proposerAndCommitteeProbability * proposerAndCommitteeReward)

  return estimatedReward + epochReward
}

function getLastLine(identity) {
  const {state, age} = identity
  if ([IdentityStatus.Invite, IdentityStatus.Candidate, IdentityStatus.Newbie].includes(state)) {
    return `_🚨You may lose 100% of the Stake if you *fail* or *miss* the upcoming validation\\._`
  }
  if (state === IdentityStatus.Verified) {
    return `_🚨You may lose 100% of the Stake if you *fail* the upcoming validation\\._`
  }
  if (state === IdentityStatus.Zombie && age >= 10) {
    return `_🚨You may lose 100% of the Stake if you *miss* the upcoming validation\\._`
  }
  if (state === IdentityStatus.Zombie && age < 10) {
    return `_🚨You may lose ${calcPercent(
      age
    )}% of the Stake if you *fail* the upcoming validation\\. You may lose 100% of the Stake if you *miss* the upcoming validation\\._`
  }
  if (state === IdentityStatus.Suspended && age < 10) {
    return `_🚨You may lose ${calcPercent(age)}% of the Stake if you *fail* the upcoming validation\\._`
  }
  if (state === IdentityStatus.Human || (state === IdentityStatus.Suspended && age >= 10)) {
    return `_🛡Your stake is protected\\. You will not lose the Stake even if you *miss* or *fail* the upcoming validation\\._`
  }
}

async function getApiData(currentEpoch) {
  try {
    const axiosInstance = axios.create({baseURL: process.env.INDEXER_URL})
    const {data: weightData} = await axiosInstance.get('staking')
    const {data: onlineMinersCount} = await axiosInstance.get('onlineminers/count')
    const {data: rewardData} = await axiosInstance.get(`epoch/${currentEpoch - 1}/rewardssummary`)
    const {data: prevEpoch} = await axiosInstance.get(`epoch/${currentEpoch - 1}`)
    const {data: currEpoch} = await axiosInstance.get(`epoch/${currentEpoch}`)

    return {
      weight: parseFloat(weightData.result.weight),
      averageMinerWeight: parseFloat(weightData.result.averageMinerWeight),
      staking: parseFloat(rewardData.result.staking),
      validation: parseFloat(rewardData.result.validation),
      onlineMinersCount,
      epochDuration: dayjs(currEpoch.result.validationTime).diff(dayjs(prevEpoch.result.validationTime), 'day'),
    }
  } catch (e) {
    logError(`[AddStakeTrigger], getApiData, error: ${e.message}`)
    return {weight: 0, reward: 0, epochDuration: 0}
  }
}

class AddStakeTrigger extends EventEmitter {
  async _do(users) {
    try {
      if (!(await isTriggerDone(ID, this.epoch))) {
        log(`[${this.constructor.name}], triggered!`)
        const apiResult = await getApiData(this.epoch)
        for (const user of users) {
          if (user.identity) {
            await this.processUser(user, apiResult)
          }
        }
        await persistTrigger(ID, this.epoch)
      }
    } catch (e) {
      logError(`[${this.constructor.name}], error: ${e.message}`)
    } finally {
      log(`[${this.constructor.name}], end trigger`)
    }
  }

  async processUser(user, apiResult) {
    try {
      const {identity} = user

      const stake = parseFloat(identity.stake)

      if (stake <= 0) return

      const notification = getNotification('add-stake')({state: IdentityStatus.Undefined})

      if (notification) {
        const epochReward = calcReward(stake, apiResult)
        this.emit('message', {
          message:
            notification
              .replaceAll('{current-stake}', escape(stake.toFixed(2)))
              .replace('{estimated-reward}', escape(epochReward.toFixed(2)))
              .replace(
                '{estimated-percent}',
                escape(((epochReward / stake / Math.max(1, apiResult.epochDuration)) * 366 * 100).toFixed(2))
              ) + getLastLine(identity),
          user,
        })
      }
    } catch (e) {
      logError(`[${this.constructor.name}], user: ${user.coinbase}, error: ${e.message}`)
    }
  }

  async start(epochData, users) {
    log(`[${this.constructor.name}], start trigger`)
    this.epoch = epochData.epoch

    const current = dayjs()
    const nextValidation = dayjs(epochData.nextValidation)

    this.timeout = setTimeout(() => this._do(users), nextValidation.subtract(2, 'day').diff(current))
  }

  stop() {
    log(`[${this.constructor.name}], stop trigger, ${ID}`)
    if (this.timeout) clearTimeout(this.timeout)
  }
}

module.exports = AddStakeTrigger
