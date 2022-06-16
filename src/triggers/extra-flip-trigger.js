/* eslint-disable no-continue */
const dayjs = require('dayjs')
const EventEmitter = require('events')
const {isTriggerDone, persistTrigger} = require('../fauna')
const {getNotification, log, logError} = require('../utils')

class ExtraFlipTrigger extends EventEmitter {
  async _do(users) {
    log(`[${this.constructor.name}], start trigger`)
    const id = 'extra-flip'
    try {
      if (!(await isTriggerDone(id, this.epoch))) {
        log(`[${this.constructor.name}], triggered!`)
        for (const user of users) {
          if (user.identity) {
            await this.processUser(user)
          }
        }
        await persistTrigger(id, this.epoch)
      }
    } catch (e) {
      logError(`[${this.constructor.name}], error: ${e.message}`)
    } finally {
      log(`[${this.constructor.name}], end trigger`)
    }
  }

  async processUser(user) {
    try {
      const {identity} = user

      if (identity.madeFlips < identity.requiredFlips) return

      const extraCount = identity.availableFlips - identity.madeFlips

      if (extraCount <= 0) return

      const notification = getNotification('extra-flip')(identity)

      if (notification) {
        this.emit('message', {
          message: notification,
          user,
        })
      }
    } catch (e) {
      logError(`[${this.constructor.name}], user: ${user.coinbase}, error: ${e.message}`)
    }
  }

  async start(epochData, users) {
    this.epoch = epochData.epoch

    const current = dayjs()
    const nextValidation = dayjs(epochData.nextValidation)

    this.timeout = setTimeout(() => this._do(users), nextValidation.subtract(20, 'hour').diff(current))
  }

  stop() {
    if (this.timeout) clearTimeout(this.timeout)
  }
}

module.exports = ExtraFlipTrigger
