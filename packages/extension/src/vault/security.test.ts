/**
 * 「密钥与明文永不落盘」的可判定形式 —— 以及导出面的封闭性。
 *
 * ## 为什么这条性质在本模块里是可判定的
 *
 * 时序上的承诺（「解锁后 15 分钟会把密钥清掉」）没法直接断言，但这里有一条
 * 更强的结构性事实：**本模块唯一的落盘出口是注入进来的 `VaultStore`**，
 * 而测试的 store 把每一次写入的原文都记了下来（`store.writes`）。
 * 于是「有没有明文或密钥被写出去」变成一个可以在事后完整回答的问题 ——
 * 不需要审计代码，只需要扫一遍那份记录。
 *
 * ## 反向验证（没有它，上面的绿不算绿）
 *
 * 「零命中」有两种解释：真的没写明文，或者**扫描对象是空的 / 扫描的根本不是
 * 那件事**。所以每条扫描都配一条反向断言：
 *   - 那些明文确实存在于被加密的档案里（否则扫描没有意义）；
 *   - 真的往里塞一份明文时，它**会被拒绝**，而记录里依然没有它。
 * 这与 T1.4 的 `b-level-never-egress.test.ts`、T3.4 的 `clean` 用例是同一个道理。
 */
import { describe, expect, it } from 'vitest'

import { emptyArchiveV1 } from '../../../core/src/schema/index'
import { maximalArchiveV1 } from '../../../core/src/schema/__fixtures__/maximal-archive'
import { createMemoryTransport } from './transport'
import * as extensionVault from './index'
import {
  OTHER_PASSPHRASE,
  WEB_PASSPHRASE,
  createFakeClock,
  createRecordingStore,
  createWebVault,
  plaintextOf,
} from './__fixtures__/harness'
import { ExtensionVaultSession } from './index'

/** 档案里真实存在的明文 —— 它们**必须**出现在被加密的内容里，也**必须**不出现在存储里。 */
const PLAINTEXT_IN_ARCHIVE = [
  '林知远',
  'Lin Zhiyuan',
  'linzhiyuan@example.com',
  '+8613800138000',
  '330106200205140011',
  '浙江省杭州市西湖区某路 1 号',
  '某某大学',
  '推荐系统',
]

/** 口令同样不许出现在任何落盘内容里。 */
const SECRETS = [...PLAINTEXT_IN_ARCHIVE, WEB_PASSPHRASE, OTHER_PASSPHRASE]

/** 走完一遍完整流程：建档 → 扩展拿到副本 → 解锁 → 读 → 接受推送 → 锁定。 */
async function fullRoundTrip(): Promise<{
  store: ReturnType<typeof createRecordingStore>
  pushedText: string
  session: ExtensionVaultSession
}> {
  const web = await createWebVault(maximalArchiveV1)
  const store = createRecordingStore(web.toVaultText())
  const session = await ExtensionVaultSession.create({
    store,
    transport: createMemoryTransport(),
    clock: createFakeClock(),
  })

  await session.unlock(WEB_PASSPHRASE)
  await session.loadArchive()

  await web.saveArchive(emptyArchiveV1())
  const pushedText = web.toVaultText()
  await session.applyPush(pushedText)

  session.lock()

  return { store, pushedText, session }
}

describe('零明文落盘', () => {
  it('完整流程里存储只被写过一次，写的是推送来的密文原文', async () => {
    const { store, pushedText } = await fullRoundTrip()

    // 建会话（只读）、解锁、读档案、锁定 —— 一个都不许写存储。
    // 这条断言同时是「密钥没有第二条落盘路径」的证据：唯一的出口就是这里，
    // 而它只被用过一次，内容是密文。
    expect(store.writes).toEqual([pushedText])
  })

  it('存储里出现过的每一份文本都不含任何明文或口令', async () => {
    const { store } = await fullRoundTrip()

    expect(store.writes.length).toBeGreaterThan(0)

    for (const text of store.writes) {
      for (const secret of SECRETS) {
        expect(text).not.toContain(secret)
      }
    }
  })

  it('反向验证：那些明文确实在档案里（否则「零命中」毫无意义）', async () => {
    const { store } = await fullRoundTrip()

    // 冻结一份「被加密的内容里确实有这些值」的证据。少了这一条，
    // 上面那条扫描在「档案其实是空的」或者「哨兵串打错了」时也会通过。
    const archivePlaintext = plaintextOf(maximalArchiveV1)
    for (const secret of PLAINTEXT_IN_ARCHIVE) {
      expect(archivePlaintext).toContain(secret)
    }

    // 而落盘的那份是密文：它有信封的结构，没有档案的内容。
    const onDisk = store.peek()
    expect(onDisk).toContain('wrappedKey')
    expect(onDisk).toContain('"payload"')
    for (const secret of PLAINTEXT_IN_ARCHIVE) {
      expect(onDisk).not.toContain(secret)
    }
  })

  it('反向验证：推一份明文进来会被拒，且它不会出现在存储里', async () => {
    const web = await createWebVault(maximalArchiveV1)
    const store = createRecordingStore(web.toVaultText())
    const session = await ExtensionVaultSession.create({
      store,
      transport: createMemoryTransport(),
      clock: createFakeClock(),
    })

    await session.unlock(WEB_PASSPHRASE)

    // 主动往这个方向推一次明文：它必须被拒，而且**不能**因为「结构校验失败」
    // 就到别处去写点什么（例如把原文当日志存下来）。
    const outcome = await session.applyPush(plaintextOf(maximalArchiveV1))

    expect(outcome).toMatchObject({ accepted: false, rejection: 'malformed_ciphertext' })
    expect(store.writes).toEqual([])
    expect(store.peek()).not.toContain('林知远')
  })

  it('锁定不写存储（密钥离开内存这件事不该在磁盘上留下痕迹）', async () => {
    const { store, session } = await fullRoundTrip()
    const writesBefore = store.writes.length

    session.lock()
    session.lock('max_lifetime')

    expect(store.writes.length).toBe(writesBefore)
    expect(session.status).toEqual({ locked: true, reason: 'manual' })
  })
})

describe('导出面是封闭的', () => {
  it('barrel 的运行时导出恰好是这些', () => {
    // 与 `core/vault` 的 API 面断言同一个套路：想在扩展端加一个
    // `exportPassphrase()` / `revealDek()` / `sendToLLM()`，必须先来这里改这一行，
    // 而改的那一行会出现在 diff 里，被看见、被追问。
    expect(Object.keys(extensionVault).sort()).toEqual([
      'DEFAULT_IDLE_TTL_MS',
      'DEFAULT_MAX_LIFETIME_MS',
      'ExtensionVaultError',
      'ExtensionVaultSession',
      'createMemoryTransport',
      'describeLockReason',
      'systemClock',
    ])
  })

  it('导出面里没有任何出网 / 模型相关的名字', () => {
    // 扩展端唯一需要出网的能力是 M3 的改写，而那条路必须经过
    // `@applypack/core/egress` 的组装层 —— 不能在这个模块里另开一条。
    const suspicious = Object.keys(extensionVault).filter((name) =>
      /llm|egress|client|send|fetch|request|upload|network/i.test(name),
    )

    expect(suspicious).toEqual([])
  })

  it('会话对象上的成员恰好是这些 —— 没有任何一个能交出密钥或口令', () => {
    const instance = Object.getOwnPropertyNames(ExtensionVaultSession.prototype).filter(
      (key) => key !== 'constructor',
    )
    const statics = Object.getOwnPropertyNames(ExtensionVaultSession).filter(
      (key) => !['length', 'name', 'prototype'].includes(key),
    )

    expect(instance.sort()).toEqual([
      'applyPush',
      'ciphertext',
      'listen',
      'loadArchive',
      'lock',
      'refreshFromStore',
      'status',
      'unlock',
      'vaultText',
    ])
    expect(statics.sort()).toEqual(['create'])
  })

  it('会话实例自身没有任何可读属性：状态全在私有字段里', async () => {
    const { session } = await fullRoundTrip()

    // 锁定态能拿到的只有两样：密文（它不是秘密，本来就是给磁盘和网络看的），
    // 以及一个「为什么没有钥匙」的原因。
    expect(session.status).toEqual({ locked: true, reason: 'manual' })
    expect(typeof session.vaultText).toBe('string')
    expect(session.ciphertext).not.toBeNull()

    // 实例上没有任何可枚举属性 —— DEK 活在 `#vault` 这个私有字段里，
    // 从外面既读不到、也列不出来。口令只以**参数**的形式存在过，
    // 从来没有变成过一个字段（`store.writes` 那条断言是它的另一半证据）。
    expect(Object.keys(session)).toEqual([])
  })
})
