/* eslint-disable no-continue */
const dayjs = require('dayjs')
const EventEmitter = require('events')
const {isTriggerDone, persistTrigger} = require('../fauna')
const {
  getNotification,
  getPercentDateByEpoch,
  logError,
  log,
  adjustDateToValidationTime,
  getIdenaProvider,
} = require('../utils')

class IssueInviteTrigger extends EventEmitter {
  async _do(path, users) {
    const id = path.join('.')
    log(`[${this.constructor.name}], start trigger, ${id}`)
    try {
      if (!(await isTriggerDone(id, this.epoch))) {
        log(`[${this.constructor.name}], triggered! ${id}`)
        for (const user of users) {
          if (user.identity) {
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

      if (identity.invites === 0) return

      const notification = getNotification(...path)(identity)

      if (!notification) return

      if (notification) {
        this.emit('message', {
          message: notification.replace('{invites-count}', identity.invites === 1 ? '1 invitation' : '2 invitations'),
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

    const currentBlock = await getIdenaProvider().Blockchain.lastBlock()
    const nextValidation = dayjs(epochData.nextValidation)

    const current = dayjs()

    const dt50percent = getPercentDateByEpoch(
      epochData.startBlock,
      nextValidation,
      currentBlock.height,
      currentBlock.timestamp,
      0.5
    )

    const dt80percent = getPercentDateByEpoch(
      epochData.startBlock,
      nextValidation,
      currentBlock.height,
      currentBlock.timestamp,
      0.8
    )

    this.timeouts.push(
      setTimeout(
        () => this._do(['issue-invite', 'left-50%-epoch'], users),
        adjustDateToValidationTime(dt50percent).diff(current)
      )
    )

    this.timeouts.push(
      setTimeout(
        () => this._do(['issue-invite', 'left-80%-epoch'], users),
        adjustDateToValidationTime(dt80percent).diff(current)
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

module.exports = IssueInviteTrigger
