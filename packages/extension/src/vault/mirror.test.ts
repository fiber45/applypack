/**
 * 密文副本的刷新断言 —— TASKS.md T1.5 的第三条：
 *
 * > 3. Web 端更新档案后，扩展能收到密文推送并刷新
 *
 * 这条看起来只是「换一份文本」，但里面藏着一个必须回答的问题：
 * **凭什么相信推来的这份密文就是同一个库的更新？** 一个被允许调用扩展的
 * 外部页面完全可以把**它自己那个库**的密文推过来 —— 结构合法、格式合法、
 * 甚至用同一个口令建的。此时：
 *
 *   - 若照单全收：扩展手里的副本被换成了一个读不出来的文件，
 *     而症状会推迟到下一次解锁才出现，且表现成「口令错误」——
 *     用户会开始怀疑自己记错了口令，处置方向完全反了。
 *   - 若按头部字段比较（盐 / `wrappedKey` 是否相同）来判断：**换口令会同时
 *     换掉这两样**，于是「头部不同」在『改了口令』与『是另一个库』两种情形里
 *     都成立，而这个判据给出的处置在两种情形下恰好相反。
 *
 * 所以判据是**判决性的一次解密**：用手里这把 DEK 解一次新 `payload`
 * （`Vault.loadPayload`）。解得开 ⇒ 同一把密钥 ⇒ 同源。这不是启发式，
 * 是密码学上的等价关系 —— 本文件里「同源判定」那组就是围着它建的。
 */
import { describe, expect, it } from 'vitest'

import { base64ToBytes, bytesToBase64 } from '../../../core/src/crypto/index'
import { emptyArchiveV1, type ArchiveV1 } from '../../../core/src/schema/index'
import { maximalArchiveV1 } from '../../../core/src/schema/__fixtures__/maximal-archive'
import { TEST_KDF_PARAMS } from '../../../core/src/vault/__fixtures__/test-params'
import {
  Vault,
  parseVaultFile,
  serializeVaultFile,
} from '../../../core/src/vault/index'
import { createMemoryTransport } from './transport'
import {
  OTHER_PASSPHRASE,
  WEB_PASSPHRASE,
  createDelayingStore,
  createEchoingStore,
  createFakeClock,
  createRecordingStore,
  createWebVault,
  plaintextOf,
  type FakeClock,
  type RecordingStore,
} from './__fixtures__/harness'
import { rejectionOf } from './__fixtures__/rejection'
import { ExtensionVaultSession, type PushOutcome } from './index'

interface Scene {
  web: Vault
  store: RecordingStore
  transport: ReturnType<typeof createMemoryTransport>
  clock: FakeClock
  session: ExtensionVaultSession
}

/** 「Web 端已建档、扩展已拿到密文并解锁」的完整场景。 */
async function unlockedScene(initial: ArchiveV1 = maximalArchiveV1): Promise<Scene> {
  const web = await createWebVault(initial)
  const store = createRecordingStore(web.toVaultText())
  const transport = createMemoryTransport()
  const clock = createFakeClock()
  const session = await ExtensionVaultSession.create({ store, transport, clock })

  await session.unlock(WEB_PASSPHRASE)
  return { web, store, transport, clock, session }
}

/** 把一份密文的 `payload` 破坏一个字节，其余（含头部）原样保留。 */
async function tamperPayload(text: string): Promise<string> {
  const file = parseVaultFile(text)
  const bytes = await base64ToBytes(file.payload.ciphertext)
  bytes[0] = (bytes[0] ?? 0) ^ 0xff

  return serializeVaultFile({
    ...file,
    payload: { ...file.payload, ciphertext: await bytesToBase64(bytes) },
  })
}

/**
 * 用**另一个口令**建一个库。
 *
 * 它与「换口令」在头部字段上的表现几乎一样（盐与 `wrappedKey` 都不同），
 * 区别只在密钥血缘 —— 正是这一点让「比较头部字段」这条路线在这里失效。
 */
async function alienVaultText(passphrase: string): Promise<string> {
  const vault = await Vault.create(passphrase, {
    params: TEST_KDF_PARAMS,
    archive: emptyArchiveV1(),
  })
  return vault.toVaultText()
}

const accepted = (outcome: PushOutcome): PushOutcome => {
  expect(outcome.accepted).toBe(true)
  return outcome
}

describe('推送刷新：Web 端保存 → 扩展跟上', () => {
  it('推送之后扩展读到新内容，且保持解锁（不必重新输口令）', async () => {
    const { web, store, session } = await unlockedScene()

    await web.saveArchive(emptyArchiveV1())
    const outcome = accepted(await session.applyPush(web.toVaultText()))

    expect(outcome.changed).toBe(true)
    expect(outcome.relocked).toBe(false)
    expect(session.status.locked).toBe(false)

    expect(await session.loadArchive()).toEqual(emptyArchiveV1())
    // 副本与存储都换成了新的那一份 —— 重启后拿到的也是它。
    expect(session.vaultText).toBe(web.toVaultText())
    expect(store.peek()).toBe(web.toVaultText())
  })

  it('落盘的是推送来的**原文**，不是重新序列化的结果', async () => {
    const { web, store, session } = await unlockedScene()

    await web.saveArchive(emptyArchiveV1())
    const text = web.toVaultText()
    await session.applyPush(text)

    // 逐字节相等。「把解析后的对象再序列化一遍」看起来等价，但缩进、
    // 键顺序、末尾换行任何一处不同，都会让「扩展存的就是 Web 端导出的那份」
    // 这句话不再逐字成立 —— 而这正是 `.vault` 备份的全部价值（T1.3 ①）。
    expect(store.writes).toEqual([text])
    expect(store.peek()).toBe(text)
  })

  it('同一条推送来两次：第二次什么都不做（幂等），也不再写存储', async () => {
    const { web, store, session } = await unlockedScene()

    await web.saveArchive(emptyArchiveV1())
    const text = web.toVaultText()

    await session.applyPush(text)
    const again = accepted(await session.applyPush(text))

    // 存储变更回声是常态（我们自己的写入就会触发一次），不幂等的话
    // 一次保存会变成「写入 → 回声 → 再写入」的循环。
    expect(again.changed).toBe(false)
    expect(store.writes).toEqual([text])
  })

  it('推五遍同一条，存储只写一次', async () => {
    const { web, store, session } = await unlockedScene()

    await web.saveArchive(emptyArchiveV1())
    const text = web.toVaultText()

    for (let i = 0; i < 5; i += 1) await session.applyPush(text)

    expect(store.writes).toEqual([text])
  })
})

describe('同源判定：凭什么相信这份密文', () => {
  it('明文不是密文：推一份明文档案 ⇒ malformed_ciphertext，副本与存储都不动', async () => {
    const { web, store, session } = await unlockedScene()
    const before = web.toVaultText()

    const outcome = await session.applyPush(plaintextOf(maximalArchiveV1))

    // 一份合法的 JSON 对象，但它不是信封。若这里放行，就会往存储里写一份
    // 谁都解不开的东西，而症状要到下次解锁才出现 —— 且表现为「口令错误」。
    expect(outcome.rejection).toBe('malformed_ciphertext')
    expect(session.vaultText).toBe(before)
    expect(store.peek()).toBe(before)
    expect(store.writes).toEqual([])
  })

  it('另一个库的密文 ⇒ ciphertext_mismatch，原副本一个字节都不动', async () => {
    const { web, store, session } = await unlockedScene()
    const before = web.toVaultText()

    // 同一个口令、同一个 KDF 档位建出来的**另一个**库：两个文件都是完全
    // 合法的信封，只有密钥不同。这正是「结构校验」拦不住的那一类。
    const alien = await createWebVault(emptyArchiveV1())
    expect(alien.toVaultText()).not.toBe(before)

    const outcome = await session.applyPush(alien.toVaultText())

    expect(outcome).toMatchObject({
      accepted: false,
      changed: false,
      rejection: 'ciphertext_mismatch',
      // 拒绝优先于代际处理：先判定「这不是我们的库」，再谈其它。
      keyGenerationChanged: true,
    })
    expect(session.vaultText).toBe(before)
    expect(store.peek()).toBe(before)
    expect(store.writes).toEqual([])

    // 会话完全没受影响：还是解锁的，还能读到原来那份档案。
    expect(session.status.locked).toBe(false)
    expect(await session.loadArchive()).toEqual(maximalArchiveV1)
  })

  it('头部一模一样、只有 payload 被改过一个字节 ⇒ 一样拒绝（判据在读内容，不是在比头部）', async () => {
    const { web, store, session } = await unlockedScene()
    const before = web.toVaultText()

    await web.saveArchive(emptyArchiveV1())
    const tampered = await tamperPayload(web.toVaultText())

    const outcome = await session.applyPush(tampered)

    // 这一条是整份文件里最要紧的断言：盐、KDF 参数、`wrappedKey` **全都一样**，
    // 只有内容被动了。任何「比较头部字段」的实现都会放行它。
    expect(outcome).toMatchObject({
      accepted: false,
      rejection: 'ciphertext_mismatch',
      keyGenerationChanged: false,
    })
    expect(session.vaultText).toBe(before)
    expect(store.peek()).toBe(before)
    expect(await session.loadArchive()).toEqual(maximalArchiveV1)
  })

  it('换口令之后推来的密文：同源，但主动降级为锁定（解锁路径验不了）', async () => {
    const { web, session } = await unlockedScene()
    const next = 'the-new-passphrase'

    await web.changePassphrase(next)
    const outcome = accepted(await session.applyPush(web.toVaultText()))

    // 内容我们读得懂（DEK 没换，这正是 core 两层密钥设计的效果），
    // 但新的 `wrappedKey` 能不能被（新）口令解开，手里没有口令，验不了。
    // 拿一份「解锁路径无法验证」的副本继续干活，会在某次重启后炸在最糟的时刻。
    expect(outcome.relocked).toBe(true)
    expect(outcome.keyGenerationChanged).toBe(true)
    expect(session.status).toEqual({ locked: true, reason: 'key_changed' })

    // 副本已经换成了新的那一份，所以新口令能开、旧口令打不开。
    expect(await rejectionOf(session.unlock(WEB_PASSPHRASE))).toBe('decryption_failed')
    await session.unlock(next)
    expect(await session.loadArchive()).toEqual(maximalArchiveV1)
  })

  it('换成另一个口令的另一个库 ⇒ 同样被拒（不是「换口令」就放行）', async () => {
    const { web, session } = await unlockedScene()
    const before = web.toVaultText()

    const alien = await alienVaultText(OTHER_PASSPHRASE)

    expect((await session.applyPush(alien)).rejection).toBe('ciphertext_mismatch')
    expect(session.vaultText).toBe(before)
    expect(session.status.locked).toBe(false)
  })
})

describe('挂起（锁定）状态下的推送', () => {
  it('采纳但不会因此解锁；之后用口令解锁就能读到新内容', async () => {
    const { web, store, clock } = await unlockedScene()
    const locked = await ExtensionVaultSession.create({
      store,
      transport: createMemoryTransport(),
      clock,
    })

    await web.saveArchive(emptyArchiveV1())
    const outcome = accepted(await locked.applyPush(web.toVaultText()))

    expect(outcome.changed).toBe(true)
    expect(outcome.relocked).toBe(false)
    expect(locked.status).toEqual({ locked: true, reason: 'never_unlocked' })
    expect(await rejectionOf(locked.loadArchive())).toBe('vault_locked:never_unlocked')

    await locked.unlock(WEB_PASSPHRASE)
    expect(await locked.loadArchive()).toEqual(emptyArchiveV1())
  })

  it('锁定态判不了同源 —— 这是有文档的边界，代价在这里被如实展示', async () => {
    const { store, clock } = await unlockedScene()
    const locked = await ExtensionVaultSession.create({
      store,
      transport: createMemoryTransport(),
      clock,
    })

    const alien = await alienVaultText(OTHER_PASSPHRASE)
    const outcome = accepted(await locked.applyPush(alien))

    // 手里没有密钥 ⇒ 没有任何可判的东西。如实采纳（只能验结构），
    // 但把「代际变了」这条线索交给调用方 —— 界面可以据此说
    // 「密文已更新，若提示口令错误，先确认 Web 端是不是改过口令」，
    // 而不是让用户以为是自己记错了。
    expect(outcome.keyGenerationChanged).toBe(true)
    expect(outcome.relocked).toBe(false)

    // 代价被如实展示：这份外来的密文打不开，而错误码是 decryption_failed
    // —— 与「口令记错了」在数学上不可区分（core 刻意如此）。
    expect(await rejectionOf(locked.unlock(WEB_PASSPHRASE))).toBe('decryption_failed')
  })

  it('存储读空时不顺手清掉会话里的副本（读不到 ≠ 用户删了）', async () => {
    const { store, session } = await unlockedScene()
    const before = session.vaultText

    await store.remove()
    const outcome = await session.refreshFromStore()

    // 「存储一时读不到」与「用户删了库」在这里无法区分，而清掉副本是不可逆的。
    // 抹除密文库是 core 的 `eraseVault`，它有明确的一次调用，不该由一次读空触发。
    expect(outcome.changed).toBe(false)
    expect(session.vaultText).toBe(before)
    expect(await session.loadArchive()).toEqual(maximalArchiveV1)
  })
})

describe('推送不能延长会话', () => {
  it('外部写入不算「使用」：空闲截止不动，绝对上限照常到期', async () => {
    const { web, clock, session } = await unlockedScene()

    clock.advance(10 * 60_000)
    await session.loadArchive()
    clock.advance(10 * 60_000)
    await session.loadArchive()

    const before = session.status
    if (before.locked) throw new Error('不该锁定')

    clock.advance(9 * 60_000)
    await web.saveArchive(emptyArchiveV1())
    const push = accepted(await session.applyPush(web.toVaultText()))
    // 推送确实生效了 —— 否则下面两条断言会因为「推送压根没到」而碰巧成立。
    expect(push.changed).toBe(true)

    const after = session.status
    if (after.locked) throw new Error('不该锁定')

    // 推送是**外部事件**，不是用户在用它。若它续期，一个能写存储 / 能发消息的
    // 页面只要每 14 分钟推一次更新，就能让密钥永远留在扩展的内存里 ——
    // 那时超时就不再是上界。这两条断言把「续期只由用户侧访问触发」钉死。
    expect(after.idleExpiresAt).toBe(before.idleExpiresAt)
    expect(after.hardExpiresAt).toBe(before.hardExpiresAt)

    clock.advance(2 * 60_000) // 31 分钟
    expect(session.status).toEqual({ locked: true, reason: 'max_lifetime' })
    expect(await rejectionOf(session.loadArchive())).toBe('vault_locked:max_lifetime')
  })
})

describe('传输接缝的行为', () => {
  it('listen 返回的取消函数真的断开订阅', async () => {
    const { web, session, transport } = await unlockedScene()
    const stop = session.listen()

    await web.saveArchive(emptyArchiveV1())
    const first = web.toVaultText()
    await transport.push(first)
    expect(session.vaultText).toBe(first)

    stop()

    await web.saveArchive(maximalArchiveV1)
    const second = web.toVaultText()
    await transport.push(second)

    // 断开了就是断开了：变化只发生在传输层，会话不再收到。
    expect(transport.pushCount).toBe(2)
    expect(session.vaultText).toBe(first)
  })

  it('存储写入的回声不会级联，也不会把测试挂死（同步回声）', async () => {
    const web = await createWebVault(maximalArchiveV1)
    const transport = createMemoryTransport()
    const store = createEchoingStore(web.toVaultText(), (text) => transport.push(text))
    const session = await ExtensionVaultSession.create({
      store,
      transport,
      clock: createFakeClock(),
    })

    session.listen()
    await session.unlock(WEB_PASSPHRASE)

    await web.saveArchive(emptyArchiveV1())
    await transport.push(web.toVaultText())

    // 一次采纳 → 一次写入 → 一次回声 → 被幂等快路径挡回。
    // 若幂等检查排在队列**之后**，这个装置会当场死锁（写入在等回声、
    // 回声在等队列、队列在等这次写入）—— 所以这条断言同时验证了顺序。
    expect(store.echoes).toBe(1)
    expect(store.writes).toEqual([web.toVaultText()])
    expect(await session.loadArchive()).toEqual(emptyArchiveV1())
  })

  it('两条推送并发时不交错：后到的版本一定会成为最终状态', async () => {
    const web = await createWebVault(emptyArchiveV1())
    // 第一次写入「很慢」（4 个微任务），第二次立即完成 —— 不排队的话
    // 旧的那份会最后落定，覆盖掉新的那份。
    const store = createDelayingStore(web.toVaultText(), [4, 0])
    const session = await ExtensionVaultSession.create({
      store,
      transport: createMemoryTransport(),
      clock: createFakeClock(),
    })

    await session.unlock(WEB_PASSPHRASE)

    await web.saveArchive(maximalArchiveV1)
    const first = web.toVaultText()
    await web.saveArchive(emptyArchiveV1())
    const second = web.toVaultText()

    const [r1, r2] = await Promise.all([session.applyPush(first), session.applyPush(second)])

    expect([r1.changed, r2.changed]).toEqual([true, true])
    expect(store.writes).toEqual([first, second])
    // 会话的视图与存储的内容必须是同一份，且是**后到的那一份**。
    expect(session.vaultText).toBe(second)
    expect(store.peek()).toBe(second)
  })
})
