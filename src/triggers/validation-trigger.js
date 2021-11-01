/* eslint-disable no-continue */
const dayjs = require('dayjs')
const {EventEmitter} = require('events')
const {isTriggerDone, persistTrigger} = require('../fauna')

class ValidationTrigger extends EventEmitter {
  async _do(id, message, users) {
    if (!(await isTriggerDone(id, this.epoch))) {
      for (const user of users) {
        this.emit('message', {
          message,
          user,
        })
      }
      await persistTrigger(id, this.epoch)
    }
  }

  async schedule(epoch, nextValidation, users) {
    this.epoch = epoch
    this.nextValidation = nextValidation

    const current = dayjs()

    setTimeout(() => this._do('validation-now', `Go🚀🚀🚀`, users), this.nextValidation.diff(current))

    setTimeout(
      () => this._do('validation-5-min', `⚡️Get ready\\!\\!\\!⚡️`, users),
      this.nextValidation.subtract(5, 'minute').diff(current)
    )

    setTimeout(
      () =>
        this._do(
          'validation-1-hour',
          `⏰*Validation ceremony starts in 1 hour*⏰\n\n⏳Make sure you have *Wait for validation* status\n\n🔛 Keep your node synchronized`,
          users
        ),
      this.nextValidation.subtract(1, 'hour').diff(current)
    )

    setTimeout(
      () =>
        this._do(
          'validation-1-day',
          `⏰*Validation ceremony starts in 1 day*⏰\n\n⏳Make sure you have *Wait for validation* status\n\n🔛 Keep your node synchronized`,
          users
        ),
      this.nextValidation.subtract(1, 'day').diff(current)
    )
  }
}

module.exports = ValidationTrigger
