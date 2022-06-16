const EventEmitter = require('events')
const {isTriggerDone, persistTrigger} = require('../fauna')
const {IdentityStatus} = require('../types')
const {getNotification, logError, log} = require('../utils')

class AcceptInviteTrigger extends EventEmitter {
  async _loop(users) {
    for (const user of users) {
      const currentState = user.identity?.state
      const prevState = this.prevStates[user.coinbase]

      if (currentState === IdentityStatus.Invite && (!prevState || prevState !== IdentityStatus.Invite)) {
        const id = `accept-invite-${user.coinbase}`

        try {
          if (!(await isTriggerDone(id, this.epoch))) {
            log(`[${this.constructor.name}], triggered! ${id}`)
            const notification = getNotification('accept-invite')(user.identity)
            if (notification) {
              this.emit('message', {
                message: notification,
                user,
              })
            }
            await persistTrigger(id, this.epoch)
          }
        } catch (e) {
          logError(`[${this.constructor.name}], error: ${e.message}, user: ${user.coinbase}`)
        }
      }

      this.prevStates[user.coinbase] = currentState
    }

    this.timeout = setTimeout(() => this._loop(users), 60 * 1000)
  }

  async start(epochData, users) {
    this.prevStates = {}
    this.epoch = epochData.epoch

    this.timeout = setTimeout(() => this._loop(users), 1)
  }

  stop() {
    if (this.timeout) clearTimeout(this.timeout)
  }
}

module.exports = AcceptInviteTrigger
