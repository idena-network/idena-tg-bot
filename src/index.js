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

watcher.on('message', async ({message, chatId}) => {
  try {
    await bot.telegram.sendMessage(chatId, message, {
      parse_mode: 'MarkdownV2',
    })
  } catch (e) {
    log(`error while writing to telegram, ${e.message}`)
  }
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
      await ctx.reply(
        `My address: *${user.data.coinbase}*\n\nAvailable commands:\n/me \\- Get my address\n/when \\- Get next validation date\n/logout \\- Logout from Idena Bot`,
        {
          parse_mode: 'MarkdownV2',
        }
      )
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

// Enable graceful stop
process.once('SIGINT', () => {
  server.close()
  bot.stop('SIGINT')
})
process.once('SIGTERM', () => {
  server.close()
  bot.stop('SIGTERM')
})
