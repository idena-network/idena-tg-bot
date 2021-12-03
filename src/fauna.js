const faunadb = require('faunadb')

const {query: q} = faunadb

const serverClient = new faunadb.Client({
  secret: process.env.FAUNADB_SECRET,
})

function createSession(token, address, nonce) {
  return serverClient.query(
    q.Create(q.Collection('sessions'), {
      data: {
        token,
        address,
        nonce,
      },
    })
  )
}

function getSession(token) {
  return serverClient.query(q.Get(q.Match(q.Index('sessions_by_token'), token)))
}

function updateSession(ref) {
  return serverClient.query(q.Update(q.Ref(ref), {data: {authenticated: true}}))
}

function addOrUpdateUser(token, tgUserId, tgChatId, tgMsgId) {
  return serverClient.query(
    q.Let(
      {
        existing: q.Match(q.Index('users_by_tgUserId'), tgUserId),
      },
      q.If(
        q.Exists(q.Var('existing')),
        q.Let(
          {
            existingRef: q.Select('ref', q.Get(q.Var('existing'))),
          },
          q.Update(q.Var('existingRef'), {data: {token, tgChatId, tgMsgId}})
        ),
        q.Create(q.Collection('users'), {
          data: {
            token,
            tgUserId,
            tgChatId,
            tgMsgId,
          },
        })
      )
    )
  )
}

function updateUser(tgUserId, data) {
  return serverClient.query(
    q.Let(
      {
        existing: q.Match(q.Index('users_by_tgUserId'), tgUserId),
      },
      q.If(
        q.Exists(q.Var('existing')),
        q.Let(
          {
            existingRef: q.Select('ref', q.Get(q.Var('existing'))),
          },
          q.Update(q.Var('existingRef'), {data})
        ),
        null
      )
    )
  )
}

function getUserByToken(token) {
  return serverClient.query(q.Get(q.Match(q.Index('users_by_token'), token)))
}

function getUserByTgId(tgUserId) {
  return serverClient.query(
    q.Let(
      {
        existing: q.Match(q.Index('users_by_tgUserId'), tgUserId),
      },
      q.If(q.Exists(q.Var('existing')), q.Get(q.Var('existing')), null)
    )
  )
}

async function getUserList() {
  const {data} = await serverClient.query(
    q.Map(
      q.Paginate(q.Match(q.Index('users_with_coinbase'), true), {size: 10000}),
      q.Lambda('ref', q.Get(q.Var('ref')))
    )
  )
  return data
}

async function isTriggerDone(id, epoch) {
  return serverClient.query(q.Exists(q.Match(q.Index('triggers_by_id_epoch'), id, epoch)))
}

async function persistTrigger(id, epoch) {
  return serverClient.query(
    q.Create(q.Collection('triggers'), {
      data: {
        id,
        epoch,
      },
    })
  )
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  addOrUpdateUser,
  updateUser,
  getUserByToken,
  getUserList,
  isTriggerDone,
  persistTrigger,
  getUserByTgId,
}
