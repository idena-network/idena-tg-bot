/* eslint-disable no-continue */
const dayjs = require('dayjs')
const EventEmitter = require('events')
const {getLastBlock} = require('../api')
const {isTriggerDone, persistTrigger} = require('../fauna')
const {getNotification, log, logError, getPercentDateByEpoch, adjustDateToValidationTime} = require('../utils')

class ValidationTrigger extends EventEmitter {
  async _doReady(path, users) {
    const id = path.join('.')
    log(`[${this.constructor.name}], start trigger, ${id}`)
    try {
      if (!(await isTriggerDone(id, this.epoch))) {
        log(`[${this.constructor.name}], triggered! ${id}`)
        for (const user of users) {
          if (user.identity && user.identity.madeFlips >= user.identity.requiredFlips) {
            await this.processUser(path, user)
          }
        }
        await persistTrigger(id, this.epoch)
      }
    } catch (e) {
      logError(`[${this.constructor.name}], error: ${e.message}`)
    } finally {
      log(`[${this.constructor.name}], end trigger, ${id}`)
    }
  }

  async _doNotReady(path, users) {
    const id = path.join('.')
    log(`[${this.constructor.name}], start trigger, ${id}`)
    try {
      if (!(await isTriggerDone(id, this.epoch))) {
        for (const user of users) {
          if (user.identity && user.identity.madeFlips < user.identity.requiredFlips) {
            await this.processUser(path, user)
          }
        }
        await persistTrigger(id, this.epoch)
      }
    } catch (e) {
      logError(`[${this.constructor.name}], error: ${e.message}`)
    } finally {
      log(`[${this.constructor.name}], end trigger, ${id}`)
    }
  }

  async processUser(path, user) {
    try {
      const {identity} = user

      const notification = getNotification(...path)(identity)

      if (notification) {
        const message = notification.replace('{days-left}', this.nextValidation.diff(dayjs(), 'day'))

        this.emit('message', {
          message,
          user,
        })
      }
    } catch (e) {
      logError(`[${this.constructor.name}], user: ${user.coinbase}, error: ${e.message}`)
    }
  }

  async start(epochData, users) {
    this.timeouts = []
    this.epoch = epochData.epoch

    const nextValidation = dayjs(epochData.nextValidation)
    this.nextValidation = nextValidation

    const currentBlock = await getLastBlock()

    const current = dayjs()

    this.timeouts.push(
      setTimeout(
        () => this._doReady(['validation', 'ready', '1-day'], users),
        nextValidation.subtract(1, 'day').diff(current)
      )
    )
    this.timeouts.push(
      setTimeout(
        () => this._doReady(['validation', 'ready', '1-hour'], users),
        nextValidation.subtract(1, 'hour').diff(current)
      )
    )
    this.timeouts.push(
      setTimeout(
        () => this._doReady(['validation', 'ready', '5-min'], users),
        nextValidation.subtract(5, 'minute').diff(current)
      )
    )
    this.timeouts.push(
      setTimeout(() => this._doReady(['validation', 'ready', 'now'], users), nextValidation.diff(current))
    )

    const dt50percent = getPercentDateByEpoch(
      epochData.startBlock,
      nextValidation,
      currentBlock.height,
      currentBlock.timestamp,
      0.5
    )

    this.timeouts.push(
      setTimeout(
        () => this._doNotReady(['validation', 'not-ready', '1-day'], users),
        nextValidation.subtract(1, 'day').diff(current)
      )
    )
    this.timeouts.push(
      setTimeout(
        () => this._doNotReady(['validation', 'not-ready', '1-hour'], users),
        nextValidation.subtract(1, 'hour').diff(current)
      )
    )
    this.timeouts.push(
      setTimeout(
        () => this._doNotReady(['validation', 'not-ready', 'left-50%-epoch'], users),
        adjustDateToValidationTime(dt50percent).diff(current)
      )
    )
  }

  stop() {
    if (this.timeouts?.length) {
      for (const timeout of this.timeouts) {
        clearTimeout(timeout)
      }
    }
  }
}

module.exports = ValidationTrigger
