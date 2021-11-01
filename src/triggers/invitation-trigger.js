/* eslint-disable no-continue */
const dayjs = require('dayjs')
const {EventEmitter} = require('events')
const {getIdentity} = require('../api')
const {isTriggerDone, persistTrigger} = require('../fauna')
const {IdentityStatus} = require('../types')

class InvitationTrigger extends EventEmitter {
  async _doUser(message, user) {
    try {
      if (
        !this.identities[user.coinbase] ||
        [IdentityStatus.Undefined, IdentityStatus.Invite].includes(this.identities[user.coinbase].state)
      ) {
        this.identities[user.coinbase] = await getIdentity(user.coinbase)
      }

      const state = this.identities[user.coinbase]?.state

      if ([IdentityStatus.Undefined, IdentityStatus.Invite].includes(state)) {
        this.emit('message', {
          message,
          user,
        })
      }
    } catch (e) {
      console.error(`[invitation] error when processing user ${user.coinbase}`, e)
    }
  }

  async _do(id, message, users) {
    if (!(await isTriggerDone(id, this.epoch))) {
      for (const user of users) {
        await this._doUser(message, user)
      }
      await persistTrigger(id, this.epoch)
    }
  }

  async schedule(epoch, nextValidation, users) {
    this.epoch = epoch
    this.nextValidation = nextValidation
    this.identities = {}

    const current = dayjs()

    setTimeout(
      () =>
        this._do(
          'invitation-1-hour',
          'The validation ceremony is in 1 hour\\. Please activate your invite and get ready\\!',
          users
        ),
      this.nextValidation.subtract(1, 'hour').diff(current)
    )

    setTimeout(
      () =>
        this._do('invitation-1-day', 'The validation ceremony is in 24 hours\\. Please activate your invite\\!', users),
      this.nextValidation.subtract(1, 'day').diff(current)
    )
  }
}

module.exports = InvitationTrigger
