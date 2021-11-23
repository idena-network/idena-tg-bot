/* eslint-disable no-continue */
const dayjs = require('dayjs')
const EventEmitter = require('events')
const {getIdentity} = require('../api')
const {isTriggerDone, persistTrigger} = require('../fauna')
const {IdentityStatus} = require('../types')
const {getNotification, logError, log} = require('../utils')

const ID = 'remind-invitee'

function getInviteeStatus(address, flipsReady, activated) {
  if (flipsReady && activated) return `${address} \\- ready for validation`
  if (!activated) return `${address} \\- invite not activated`
  return `${address} \\- flips not submitted`
}

class InviteeReminderTrigger extends EventEmitter {
  async _do(users) {
    log(`[${this.constructor.name}], start trigger, ${ID}`)
    try {
      if (!(await isTriggerDone(ID, this.epoch))) {
        log(`[${this.constructor.name}], triggered! ${ID}`)
        for (const user of users) {
          if (user.identity) {
            await this.processUser(user)
          }
        }
        await persistTrigger(ID, this.epoch)
      }
    } catch (e) {
      logError(`[${this.constructor.name}], error: ${e.message}`)
    } finally {
      log(`[${this.constructor.name}], end trigger, ${ID}`)
    }
  }

  async processUser(user) {
    try {
      const {identity} = user

      if (!identity.invitees?.length) return

      const result = []

      for (const invitee of identity.invitees) {
        const {Address: address} = invitee

        const inviteeIdentity = await getIdentity(address)

        const flipsReady = inviteeIdentity.madeFlips >= inviteeIdentity.requiredFlips

        result.push({address, flipsReady, activated: inviteeIdentity.state !== IdentityStatus.Invite})
      }

      const segment = result.every(x => x.flipsReady && x.activated) ? 'invitee-ready' : 'invitee-not-ready'

      let notification = getNotification('remind-invitee', segment)(identity)
      if (notification) {
        for (const invitee of result) {
          notification += `\n${getInviteeStatus(invitee.address, invitee.flipsReady, invitee.activated)}`
        }

        this.emit('message', {
          message: notification,
          user,
        })
      }
    } catch (e) {
      console.error(`[${this.constructor.name}], user: ${user.coinbase}, error: ${e.message}`)
    }
  }

  async start(epochData, users) {
    this.epoch = epochData.epoch

    const nextValidation = dayjs(epochData.nextValidation)

    const current = dayjs()

    this.timeout = setTimeout(() => this._do(users), nextValidation.subtract(2, 'day').diff(current))
  }

  stop() {
    if (this.timeout) clearTimeout(this.timeout)
  }
}

module.exports = InviteeReminderTrigger
