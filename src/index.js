require('dotenv-flow').config()

const {v4: uuidv4} = require('uuid')
const {Telegraf, Markup} = require('telegraf')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const {GenerateDnaUrl, escape} = require('./utils')
const {startWebServer} = require('./webserver')
const {addOrUpdateUser, getUserByToken, getSession, updateUser} = require('./fauna')

dayjs.extend(utc)

process.on('unhandledRejection', error => {
  console.error(error.stack || error)
})

const Watcher = require('./watcher')

const bot = new Telegraf(process.env.BOT_TOKEN)

const watcher = new Watcher()

watcher.on('message', async ({message, chatId}) => {
  try {
    await bot.telegram.sendMessage(chatId, message, {
      parse_mode: 'MarkdownV2',
    })
  } catch (e) {
    console.log(e)
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
    console.error(e)
  }
}

const server = startWebServer(onAuth)

// Matches /love
bot.hears(/\/start/, async ctx => {
  const id = uuidv4()

  const msg = await ctx.reply(
    'Hello, please login to recieve notifications',
    Markup.inlineKeyboard([Markup.button.url('Login through Idena', GenerateDnaUrl(id))])
  )

  await addOrUpdateUser(id, ctx.message.from.id, ctx.message.chat.id, msg.message_id)
})

bot.hears(/\/when/, async ctx => {
  try {
    const dt = dayjs(watcher.epochData.validationTime).utc()

    await ctx.reply(`Next validation date: *${escape(dt.format('YYYY-MM-DD HH:mm:ss UTC'))}*`, {
      parse_mode: 'MarkdownV2',
    })
  } catch (e) {
    console.error(e)
  }
})

// Handle callback queries
bot.on('callback_query', function onCallbackQuery(ctx) {
  console.log(ctx)
  //   const action = callbackQuery.data
  //   const msg = callbackQuery.message
  //   const opts = {
  //     chat_id: msg.chat.id,
  //     message_id: msg.message_id,
  //   }
  //   let text

  //   if (action === 'edit') {
  //     text = 'Edited Text'
  //   }

  //   bot.editMessageText('yes yes yes', opts)
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
