require('dotenv-flow').config()

const {v4: uuidv4} = require('uuid')
const {Telegraf, Markup} = require('telegraf')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const {GenerateDnaUrl, escape, log, logError} = require('./utils')
const {startWebServer} = require('./webserver')
const {addOrUpdateUser, getUserByToken, getSession, updateUser, getUserByTgId, deleteUserByTgId} = require('./fauna')

dayjs.extend(utc)

process.on('unhandledRejection', error => {
  logError(error.stack || error)
})

const Watcher = require('./watcher')
const InviteeReminderTrigger = require('./triggers/invitee-reminder-trigger')

const bot = new Telegraf(process.env.BOT_TOKEN)

const watcher = new Watcher()

const commands = [
  '/me \\- Get my address',
  '/when \\- Get next validation date',
  '/invitees \\- Check my invitees',
  '/logout \\- Logout from Idena Bot',
]

const tgQueue = []
let stopped = false

function sendTgMessageLoop() {
  const data = tgQueue.shift()

  if (!data) {
    if (!stopped) setTimeout(sendTgMessageLoop, 1)
    return
  }

  const {message, chatId, action} = data

  let extra = {
    parse_mode: 'MarkdownV2',
  }

  if (action) {
    extra = {
      ...extra,
      ...Markup.inlineKeyboard([Markup.button.url(action.title, action.url)]),
    }
  }

  bot.telegram
    .sendMessage(chatId, message, extra)
    .then(() => setTimeout(sendTgMessageLoop, 1))
    .catch(e => {
      if (e.response?.error_code === 429) {
        log(
          `rate limit while writing to telegram, try_after: ${e.response.parameters?.retry_after}, queue_size: ${tgQueue.length}`
        )
        const waitSeconds = e.response.parameters?.retry_after || 5
        tgQueue.unshift(data)
        setTimeout(sendTgMessageLoop, waitSeconds * 1000)
      } else if (e.response?.error_code === 403) {
        deleteUserByTgId(chatId).catch(err => {
          log(`cannot delete user, reason: 403, error: ${err.message}`)
        })
        setTimeout(sendTgMessageLoop, 1)
      } else {
        log(`error while writing to telegram, error: ${e.message}`)
        setTimeout(sendTgMessageLoop, 1)
      }
    })
}

watcher.on('message', ({message, chatId, action}) => {
  tgQueue.push({message, chatId, action})
})

async function onAuth(token) {
  try {
    const user = await getUserByToken(token)
    const session = await getSession(token)

    if (!session.data.authenticated) {
      return bot.telegram.sendMessage(user.data.tgChatId, 'authentication failed, try again')
    }

    await bot.telegram.deleteMessage(user.data.tgChatId, user.data.tgMsgId)

    await updateUser(user.data.tgUserId, {coinbase: session.data.address})

    watcher.onNewUser({
      dbId: user.ref.id,
      userId: user.data.tgUserId,
      chatId: user.data.tgChatId,
      coinbase: session.data.address,
    })

    await bot.telegram.sendMessage(user.data.tgChatId, `Success\\! Your address is *${session.data.address}*`, {
      parse_mode: 'MarkdownV2',
    })
  } catch (e) {
    logError(`error while executing onAuth: ${e.message}`)
  }
}

const server = startWebServer(onAuth)

// Matches /love
bot.hears(/\/start/, async ctx => {
  try {
    const user = await getUserByTgId(ctx.message.from.id)

    if (user?.data?.coinbase) {
      await ctx.reply(`My address: *${user.data.coinbase}*\n\nAvailable commands:\n${commands.join('\n')}`, {
        parse_mode: 'MarkdownV2',
      })
    } else {
      const id = uuidv4()

      const msg = await ctx.reply(
        'Hello, please login to recieve notifications',
        Markup.inlineKeyboard([Markup.button.url('Login with Idena App', GenerateDnaUrl(id))])
      )

      await addOrUpdateUser(id, ctx.message.from.id, ctx.message.chat.id, msg.message_id)
    }
  } catch (e) {
    logError(`error while executing /start: ${e.message}`)
  }
})

bot.hears(/\/when/, async ctx => {
  try {
    const dt = dayjs(watcher.epochData.nextValidation).utc()

    await ctx.reply(`Next validation date: *${escape(dt.format('YYYY-MM-DD HH:mm:ss UTC'))}*`, {
      parse_mode: 'MarkdownV2',
    })
  } catch (e) {
    logError(`error while executing /when: ${e.message}`)
  }
})

bot.hears(/\/me/, async ctx => {
  try {
    const user = await getUserByTgId(ctx.message.from.id)
    if (user?.data?.coinbase) {
      await ctx.reply(`My address: *${user.data.coinbase}*`, {
        parse_mode: 'MarkdownV2',
      })
    } else {
      await ctx.reply('No user found! Please /start Idena bot.')
    }
  } catch (e) {
    logError(`error while executing /me: ${e.message}`)
  }
})

bot.hears(/\/invitees/, async ctx => {
  try {
    const user = await getUserByTgId(ctx.message.from.id)
    if (user?.data?.coinbase) {
      const trigger = new InviteeReminderTrigger()
      const notification = await trigger.forceCheck(user?.data?.coinbase)
      if (notification) {
        await ctx.reply(notification, {
          parse_mode: 'MarkdownV2',
        })
      } else {
        await ctx.reply('No invitees.')
      }
    } else {
      await ctx.reply('No user found! Please /start Idena bot.')
    }
  } catch (e) {
    logError(`error while executing /invitees: ${e.message}`)
  }
})

bot.hears(/\/logout/, async ctx => {
  try {
    const user = await getUserByTgId(ctx.message.from.id)
    if (user?.data?.coinbase) {
      await deleteUserByTgId(ctx.message.from.id)
      await ctx.reply('Logout successful')
      watcher.onDeleteUser(user.ref.id)
    } else {
      await ctx.reply('No user found! Please /start Idena bot.')
    }
  } catch (e) {
    logError(`error while executing /me: ${e.message}`)
  }
})

watcher.launch()

bot.launch()

sendTgMessageLoop()

// Enable graceful stop
process.once('SIGINT', () => {
  stopped = true
  server.close()
  bot.stop('SIGINT')
})
process.once('SIGTERM', () => {
  stopped = true
  server.close()
  bot.stop('SIGTERM')
})
