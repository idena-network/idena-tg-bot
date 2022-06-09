/* eslint-disable no-continue */
const EventEmitter = require('events')
const {Transaction, TransactionType, CallContractAttachment, ContractArgumentFormat} = require('idena-sdk-js')
const {persistTrigger, getTrigger, upsertOraclePublicVoting, getOraclePublicVotings} = require('../fauna')
const {getNotification, log, logError, escape, getIdenaProvider, sleep} = require('../utils')

const ID = 'oracle-watcher'

async function checkCoinbaseInCommitee(provider, contract, address) {
  try {
    await provider.Contract.readonlyCall(contract, 'proof', ContractArgumentFormat.Hex, [
      {format: ContractArgumentFormat.Hex, index: 0, value: address},
    ])
    return true
  } catch {
    return false
  }
}

async function getCommiteeSize(provider, contract) {
  try {
    return provider.Contract.readData(contract, 'committeeSize', ContractArgumentFormat.Uint64)
  } catch {
    return 0
  }
}

async function getVoteBlock(provider, contract) {
  try {
    return await provider.Contract.readonlyCall(contract, 'voteBlock', ContractArgumentFormat.Uint64)
  } catch {
    return 0
  }
}

async function checkUserHasPublicVote(provider, contract, coinbase) {
  try {
    await provider.Contract.readMap(contract, 'votes', coinbase, ContractArgumentFormat.Hex)
    return true
  } catch {
    return false
  }
}

async function checkUserHasPrivateVote(provider, contract, coinbase) {
  try {
    await provider.Contract.readMap(contract, 'voteHashes', coinbase, ContractArgumentFormat.Hex)
    return true
  } catch {
    return false
  }
}

async function getPrizePool(provider, contract) {
  try {
    const balance = await provider.Dna.balance(contract)

    const ownerFee = await provider.Contract.readData(contract, 'ownerFee', ContractArgumentFormat.Byte)

    return parseFloat(balance.balance) * (1 - parseInt(ownerFee) / 100)
  } catch {
    return 0
  }
}

class VotingStartTrigger extends EventEmitter {
  constructor() {
    super()
    this.provider = getIdenaProvider()
    this._stop = false
  }

  async _do(users) {
    try {
      const trigger = await getTrigger(ID, 0)

      if (!trigger) await persistTrigger(ID, 0, {block: 1})

      let blockNum = trigger?.data?.block || 1

      while (!this._stop) {
        try {
          const block = await this.provider.Blockchain.blockAt(blockNum + 1)

          if (!block) {
            await sleep(5000)
            continue
          }

          log(`[${this.constructor.name}] [_do], process block: ${blockNum + 1}`)

          if (block.transactions) {
            await this.processBlock(block, users)
          }

          await this.processDelayed(block, users)

          blockNum += 1

          await persistTrigger(ID, 0, {block: blockNum})

          await sleep(1)
        } catch (e) {
          logError(`[${this.constructor.name}] [_do], error: ${e?.message}`)
          await sleep(1000)
        }
      }
    } catch (e) {
      logError(`[${this.constructor.name}] [_do], start error: ${e?.message}`)
      setTimeout(() => this._do(users), 5000)
    }
  }

  async processDelayed(block, users) {
    try {
      const votings = await getOraclePublicVotings(block.height)
      for (const voting of votings) {
        const {contract} = voting.data
        try {
          for (const user of users) {
            if (!user.identity) continue
            try {
              const hasPublicVote = await checkUserHasPublicVote(this.provider, contract, user.coinbase)

              if (hasPublicVote) continue

              const hasPrivateVote = await checkUserHasPrivateVote(this.provider, contract, user.coinbase)

              if (!hasPrivateVote) continue

              const notification = getNotification('oracle-public-voting')(user.identity)

              if (notification) {
                this.emit('message', {
                  message: notification,
                  user,
                  action: {
                    title: 'Login into Idena app',
                    url: 'https://app.idena.io/wallets',
                  },
                })
              }
            } catch (e) {
              logError(
                `[${this.constructor.name}] [processDelayed], process start oracle: [${voting.contract}], user: [${user.coinbase}] error: ${e.message}`
              )
            }
          }
        } catch (e) {
          logError(
            `[${this.constructor.name}] [processDelayed], cannot process one voting [${voting.contract}], error: [${e.message}]`
          )
        }
      }
    } catch (e) {
      logError(
        `[${this.constructor.name}] [processDelayed], cannot process oracle public voting, error: [${e.message}]`
      )
    }
  }

  async processBlock(block, users) {
    const {transactions} = block

    for (const txId of transactions) {
      try {
        const jsonTx = await this.provider.Blockchain.transaction(txId)

        const tx = new Transaction().fromJson(jsonTx)

        if (tx.type !== TransactionType.CallContractTx) {
          continue
        }

        const attachment = new CallContractAttachment().fromBytes(tx.payload)

        if (attachment.method === 'startVoting') {
          await this.processStartTx(tx, users)
          continue
        }

        if (attachment.method === 'prolongVoting') {
          await this.processProlongTx(tx, users)
          continue
        }
      } catch (e) {
        logError(`[${this.constructor.name}], process tx: [${txId}], error: ${e.message}`)
      }
    }
  }

  async processStartTx(tx, users) {
    const contract = tx.to

    log(`[${this.constructor.name}], start voting: ${contract}`)

    const commiteeSize = await getCommiteeSize(this.provider, contract)
    const prizePool = await getPrizePool(this.provider, contract)

    for (const user of users) {
      if (!user.identity) continue
      try {
        const userInCommmitee = await checkCoinbaseInCommitee(this.provider, contract, user.coinbase)

        if (!userInCommmitee) continue

        const notification = getNotification('oracle-voting-new')(user.identity)

        if (notification) {
          this.emit('message', {
            message: notification
              .replace('{commitee-size}', commiteeSize)
              .replace('{prize-pool}', escape(prizePool.toFixed(2))),
            user,
            action: {
              title: 'Click to vote',
              url: `https://app.idena.io/oracles/view?id=${contract}`,
            },
          })
        }
      } catch (e) {
        logError(
          `[${this.constructor.name}] [processStartTx], process start oracle: [${contract}], user: [${user.coinbase}] error: ${e.message}`
        )
      }
    }

    const voteBlock = await getVoteBlock(this.provider, contract)
    if (!voteBlock) {
      logError(`[${this.constructor.name}] [processStartTx], cannot read vote block: [${contract}]`)
      return
    }

    const delayedBlock = voteBlock + 3 * 10 // 10 min

    try {
      await upsertOraclePublicVoting(contract, delayedBlock)
    } catch (e) {
      logError(
        `[${this.constructor.name}] [processStartTx], cannot add oracle public voting: [${contract}], error: ${e.message}`
      )
    }
  }

  async processProlongTx(tx, users) {
    const contract = tx.to

    log(`[${this.constructor.name}], prolong voting: ${contract}`)

    const commiteeSize = await getCommiteeSize(this.provider, contract)
    const prizePool = await getPrizePool(this.provider, contract)

    for (const user of users) {
      if (!user.identity) continue
      try {
        const userInCommmitee = await checkCoinbaseInCommitee(this.provider, contract, user.coinbase)

        if (!userInCommmitee) continue

        const hasPrivateVote = await checkUserHasPrivateVote(this.provider, contract, user.coinbase)

        if (hasPrivateVote) continue

        const notification = getNotification('oracle-voting-new')(user.identity)

        if (notification) {
          this.emit('message', {
            message: notification
              .replace('{commitee-size}', commiteeSize)
              .replace('{prize-pool}', escape(prizePool.toFixed(2))),
            user,
            action: {
              title: 'Click to vote',
              url: `https://app.idena.io/oracles/view?id=${contract}`,
            },
          })
        }
      } catch (e) {
        logError(
          `[${this.constructor.name}] [processProlongTx], process start oracle: [${contract}], user: [${user.coinbase}] error: ${e.message}`
        )
      }
    }

    const voteBlock = await getVoteBlock(this.provider, contract)
    if (!voteBlock) {
      logError(`[${this.constructor.name}] [processProlongTx], cannot read vote block: [${contract}]`)
      return
    }

    const delayedBlock = voteBlock + 3 * 10 // 10 min

    try {
      await upsertOraclePublicVoting(contract, delayedBlock)
    } catch (e) {
      logError(
        `[${this.constructor.name}] [processProlongTx], cannot add oracle public voting: [${contract}], error: ${e.message}`
      )
    }
  }

  async start(epochData, users) {
    log(`[${this.constructor.name}], start trigger, ${ID}`)
    this._stop = false
    this.epoch = epochData.epoch
    this._do(users)
  }

  stop() {
    log(`[${this.constructor.name}], stop trigger, ${ID}`)
    this._stop = true
  }
}

module.exports = VotingStartTrigger
