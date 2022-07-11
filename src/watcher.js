const dayjs = require('dayjs')
const {EventEmitter} = require('events')
const {getUserList} = require('./fauna')
const AcceptInviteTrigger = require('./triggers/accept-invite-trigger')
const AddStakeTrigger = require('./triggers/add-stake-trigger')
const ExtraFlipTrigger = require('./triggers/extra-flip-trigger')
const InviteeReminderTrigger = require('./triggers/invitee-reminder-trigger')
const IssueInviteTrigger = require('./triggers/issue-invite-trigger')
const ValidationResultTrigger = require('./triggers/validation-result-trigger')
const ValidationTrigger = require('./triggers/validation-trigger')
const VotingStartTrigger = require('./triggers/voting-start-trigger')
const {log, logError, sleep, getIdenaProvider} = require('./utils')

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
  VotingStartTrigger,
  AddStakeTrigger,
]

async function waitForNode() {
  const provider = getIdenaProvider()
  let epoch = null
  while (!epoch) {
    try {
      epoch = await provider.Dna.epoch()
    } catch (e) {
      logError('node is not ready!')
      await sleep(1000)
    }
  }
}

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
      logError(`error while loading users ${e.message}`)
      throw new Error('canot load users')
    }
  }

  async _registerTriggers() {
    this.triggers = []

    for (const T of allTriggers) {
      const tg = new T()
      tg.on('message', ({message, user, action}) => this.emit('message', {message, chatId: user.chatId, action}))
      this.triggers.push(tg)
    }
  }

  async _waitForNewEpoch(prevEpoch) {
    const newEpochData = await getIdenaProvider().Dna.epoch()

    // validation finished
    if (prevEpoch !== newEpochData.epoch) {
      await this._updateIdentities()
      await this._restartTriggers()
    } else {
      setTimeout(() => this._waitForNewEpoch(prevEpoch), 5 * 60 * 1000)
    }
  }

  async _restartTriggers() {
    for (const trigger of this.triggers) trigger.stop()

    this.epochData = await getIdenaProvider().Dna.epoch()
    const {epoch, nextValidation} = this.epochData

    log(`restart triggers, epoch: ${epoch}, next validation: ${nextValidation}`)

    // run validation result trigger
    const resultTrigger = new ValidationResultTrigger()
    resultTrigger.on('message', ({message, user}) => this.emit('message', {message, chatId: user.chatId}))
    await resultTrigger.start(this.epochData, this.users)

    for (const trigger of this.triggers) {
      await trigger.start(this.epochData, this.users)
    }

    setTimeout(() => this._waitForNewEpoch(epoch), dayjs(nextValidation).diff(dayjs()))
  }

  async launch() {
    log('launching bot')

    await waitForNode()

    await this._loadUsers()
    await this._updateIdentities()

    this._registerTriggers()
    this.ready = true

    await this._restartTriggers()

    log('launch done!')
  }

  onNewUser(data) {
    const index = this.users.findIndex(x => x.dbId === data.dbId)

    if (index === -1) {
      this.users.push(data)
    } else {
      this.users[index] = data
    }
  }

  onDeleteUser(dbId) {
    const index = this.users.findIndex(x => x.dbId === dbId)

    if (index !== -1) {
      this.users.splice(index, 1)
    }
  }

  async _updateIdentities() {
    if (this.identitiesTimeout) clearTimeout(this.identitiesTimeout)

    const provider = getIdenaProvider()
    for (const user of this.users) {
      try {
        const identity = await provider.Dna.identity(user.coinbase)

        if (identity) {
          user.identity = identity
        }
      } catch (e) {
        logError(`error while loading identity ${e.message}`)
      }
    }

    this.identitiesTimeout = setTimeout(() => this._updateIdentities(), 5 * 60 * 1000)
  }
}

module.exports = Watcher
