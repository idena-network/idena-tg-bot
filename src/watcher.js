const dayjs = require('dayjs')
const {EventEmitter} = require('events')
const {getEpoch} = require('./api')
const {getUserList} = require('./fauna')
const InvitationTrigger = require('./triggers/invitation-trigger')
const ValidationTrigger = require('./triggers/validation-trigger')

class Watcher extends EventEmitter {
  constructor() {
    super()
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
    const tg1 = new ValidationTrigger()
    tg1.on('message', ({message, user}) => this.emit('message', {message, chatId: user.chatId}))
    this.triggers.push(tg1)

    const tg2 = new InvitationTrigger()
    tg2.on('message', ({message, user}) => this.emit('message', {message, chatId: user.chatId}))
    this.triggers.push(tg2)
  }

  async _waitForNewEpoch(prevEpoch) {
    const {epoch: newEpoch} = await getEpoch()
    if (prevEpoch !== newEpoch) {
      this._restartTriggers()
    } else {
      setTimeout(() => this._waitForNewEpoch(prevEpoch), 5 * 60 * 1000)
    }
  }

  async _restartTriggers() {
    this.epochData = await getEpoch()
    const {epoch, validationTime} = this.epochData

    for (const trigger of this.triggers) {
      trigger.schedule(epoch, dayjs(validationTime), this.users)
    }

    setTimeout(() => this._waitForNewEpoch(epoch), dayjs(validationTime).diff(dayjs()))
  }

  async launch() {
    await this._loadUsers()
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
}

module.exports = Watcher
