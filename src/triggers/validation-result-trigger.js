const EventEmitter = require('events')
const {isTriggerDone, persistTrigger} = require('../fauna')
const {getNotification, logError, log, buildNextValidationCalendarLink} = require('../utils')

const ID = 'validation-result'

class ValidationResultTrigger extends EventEmitter {
  async start(epochData, users) {
    const {nextValidation, epoch} = epochData
    try {
      if (!(await isTriggerDone(ID, epoch))) {
        log(`[${this.constructor.name}], triggered! ${ID}`)
        for (const user of users) {
          const notification = getNotification(ID)(user.identity)
          if (notification) {
            const message = notification
              .replace('{identity-state}', user.identity.state)
              .replace('{report-link}', `https://scan.idena.io/identity/${user.coinbase}/epoch/${epoch}/validation`)
              .replace('{calendar-link}', buildNextValidationCalendarLink(nextValidation))

            this.emit('message', {
              message,
              user,
            })
          }
        }
        await persistTrigger(ID, epoch)
      }
    } catch (e) {
      logError(`[${this.constructor.name}], error: ${e.message}`)
    }
  }
}

module.exports = ValidationResultTrigger
