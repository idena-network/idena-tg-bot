const dayjs = require('dayjs')
const {EventEmitter} = require('events')
const {getEpoch, getIdentity} = require('./api')
const {getUserList} = require('./fauna')
const AcceptInviteTrigger = require('./triggers/accept-invite-trigger')
const ExtraFlipTrigger = require('./triggers/extra-flip-trigger')
const InviteeReminderTrigger = require('./triggers/invitee-reminder-trigger')
const IssueInviteTrigger = require('./triggers/issue-invite-trigger')
const ValidationResultTrigger = require('./triggers/validation-result-trigger')
const ValidationTrigger = require('./triggers/validation-trigger')
const {log} = require('./utils')

/**
 * @typedef User
 * @type {object}
 * @property {string} dbId - faund db id.
 * @property {number} userId - telegram user id.
 * @property {number} chatId - tyelegram chat id.
 * @property {string} coinbase - coinbase.
 * @property {object} identity - identity object.
 */

const allTriggers = [
  ExtraFlipTrigger,
  AcceptInviteTrigger,
  IssueInviteTrigger,
  ValidationTrigger,
  InviteeReminderTrigger,
]

class Watcher extends EventEmitter {
  constructor() {
    super()

    /** @type {User[]} */
    this.users = []

    this.triggers = []
  }

  async _loadUsers() {
    try {
      const list = await getUserList()

      list.forEach(element => {
        this.users.push({
          dbId: element.ref.id,
          userId: element.data.tgUserId,
          chatId: element.data.tgChatId,
          coinbase: element.data.coinbase,
        })
      })
    } catch (e) {
      console.error(e)
      throw new Error('canot load users')
    }
  }

  async _registerTriggers() {
    for (const trigger of this.triggers) trigger.stop()

    this.triggers = []

    for (const T of allTriggers) {
      const tg = new T()
      tg.on('message', ({message, user}) => this.emit('message', {message, chatId: user.chatId}))
      this.triggers.push(tg)
    }
  }

  async _waitForNewEpoch(prevEpoch) {
    const newEpochData = await getEpoch()

    // validation finished
    if (prevEpoch !== newEpochData.epoch) {
      const resultTrigger = new ValidationResultTrigger()
      resultTrigger.on('message', ({message, user}) => this.emit('message', {message, chatId: user.chatId}))
      await resultTrigger.start(newEpochData, this.users)

      this._restartTriggers()
    } else {
      setTimeout(() => this._waitForNewEpoch(prevEpoch), 5 * 60 * 1000)
    }
  }

  async _restartTriggers() {
    this.epochData = await getEpoch()
    const {epoch, nextValidation} = this.epochData

    log(`restart triggers, epoch: ${epoch}, next validation: ${nextValidation}`)

    for (const trigger of this.triggers) {
      await trigger.start(this.epochData, this.users)
    }

    setTimeout(() => this._waitForNewEpoch(epoch), dayjs(nextValidation).diff(dayjs()))
  }

  async launch() {
    await this._loadUsers()
    await this._updateIdentities()

    this._registerTriggers()
    this.ready = true

    this._restartTriggers()
  }

  onNewUser(data) {
    const index = this.users.findIndex(x => x.dbId === data.dbId)

    if (index === -1) {
      this.users.push(data)
    } else {
      this.users[index] = data
    }
  }

  async _updateIdentities() {
    for (const user of this.users) {
      try {
        const identity = await getIdentity(user.coinbase)

        if (identity) {
          user.identity = identity
        }
      } catch (e) {
        console.error('error while loading identity', e)
      }
    }

    setTimeout(() => this._updateIdentities(), 60 * 1000)
  }
}

module.exports = Watcher
