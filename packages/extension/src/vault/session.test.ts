/**
 * 扩展侧密文副本的会话断言 —— TASKS.md T1.5 的前两条。
 *
 * > 1. 扩展持同一份密文，用同一口令独立解锁，会话内 15min TTL
 * > 2. 扩展重启后必须重新解锁
 *
 * 这两条都是**时间**相关的性质，而时间相关的测试最容易退化成两种东西：
 * 一是 `await sleep(16 分钟)`（没人会跑、跑了会闪断），二是一堆
 * 「差不多在第 15 分钟前后」的模糊断言（结论随机器负载变化）。
 * 所以这里把时间也做成注入的接缝（`clock.ts`），每个用例只做一件事：
 * **把表拨一下，然后问一句话**。整份文件没有一个等待。
 *
 * 分组对应三条不同的不变量：
 *   A. 解锁 —— 同一份密文、同一个口令、两个互不影响的会话
 *   B. 超时 —— 两条绳子（空闲 TTL / 绝对上限）各管一边
 *   C. 重启 —— 密钥活不过一次重启
 */
import { describe, expect, it } from 'vitest'

import { emptyArchiveV1 } from '../../../core/src/schema/index'
import { maximalArchiveV1 } from '../../../core/src/schema/__fixtures__/maximal-archive'
import { createMemoryTransport } from './transport'
import { createFakeClock, createRecordingStore, createWebVault } from './__fixtures__/harness'
import { rejectionOf } from './__fixtures__/rejection'
import {
  DEFAULT_IDLE_TTL_MS,
  DEFAULT_MAX_LIFETIME_MS,
  ExtensionVaultSession,
  describeLockReason,
  type Clock,
  type LockReason,
} from './index'

/** 建一个「Web 端已建档、扩展已拿到密文」的场景。 */
async function mirrorScene(): Promise<{
  web: Awaited<ReturnType<typeof createWebVault>>
  store: ReturnType<typeof createRecordingStore>
  clock: ReturnType<typeof createFakeClock>
  session: ExtensionVaultSession
}> {
  const web = await createWebVault(maximalArchiveV1)
  const store = createRecordingStore(web.toVaultText())
  const clock = createFakeClock()
  const session = await ExtensionVaultSession.create({
    store,
    transport: createMemoryTransport(),
    clock,
  })
  return { web, store, clock, session }
}

const build = (
  store: ReturnType<typeof createRecordingStore>,
  clock: Clock,
): Promise<ExtensionVaultSession> =>
  ExtensionVaultSession.create({ store, transport: createMemoryTransport(), clock })

describe('A. 解锁：同一份密文，两个独立会话', () => {
  it('扩展用同一个口令独立解锁，读到的档案与 Web 端深相等', async () => {
    const { web, session } = await mirrorScene()

    expect(session.status).toEqual({ locked: true, reason: 'never_unlocked' })

    await session.unlock('correct horse battery staple')

    expect(await session.loadArchive()).toEqual(maximalArchiveV1)
    // 「持同一份密文」这句话的直接证据：副本与 Web 端的信封**逐字段相等**。
    expect(session.ciphertext).toEqual(web.file)
    expect(session.vaultText).toBe(web.toVaultText())
  })

  it('会话建立时只读一次存储、不写任何东西', async () => {
    const { store } = await mirrorScene()

    // 副本不是我产生的，没有理由写回去 —— 而每次多余的写入都会触发一次
    // 存储变更回声，把一个纯粹的读操作变成一次写 + 一次通知。
    expect(store.readCount).toBe(1)
    expect(store.writes).toEqual([])
  })

  it('本设备还没有副本时抛 no_ciphertext —— 没有任何口令能解决它', async () => {
    const clock = createFakeClock()
    const session = await build(createRecordingStore(null), clock)

    // 这一条必须与「已锁定」区分开：混为一谈会让用户在一个自己无法解决的问题上
    // 反复重试口令（T1.3 里「忘了先解锁 ≠ 口令错误」那件事的第二次出现）。
    expect(await rejectionOf(session.unlock('whatever'))).toBe('no_ciphertext:-')
    expect(session.ciphertext).toBeNull()
    expect(session.vaultText).toBeNull()
  })

  it('口令错 ⇒ decryption_failed，且会话保持锁定（不留半开状态）', async () => {
    const { store, session } = await mirrorScene()

    expect(await rejectionOf(session.unlock('a-completely-different-passphrase'))).toBe(
      'decryption_failed',
    )
    expect(session.status).toEqual({ locked: true, reason: 'never_unlocked' })
    expect(await rejectionOf(session.loadArchive())).toBe('vault_locked:never_unlocked')
    expect(store.writes).toEqual([])
  })

  it('空口令被直接拒绝（invalid_params），而不是当成一个可用口令去试', async () => {
    const { session } = await mirrorScene()
    expect(await rejectionOf(session.unlock(''))).toBe('invalid_params')
  })

  it('锁定之后：读档案抛 vault_locked，而密文副本仍然可读', async () => {
    const { web, session } = await mirrorScene()
    await session.unlock('correct horse battery staple')
    session.lock()

    // 报「已锁定」而不是「口令错误」：后者会让用户开始怀疑自己记错口令。
    expect(await rejectionOf(session.loadArchive())).toBe('vault_locked:manual')

    // 副本不是秘密 —— 它本来就是给磁盘和网络看的东西，锁定不该把它也收走。
    expect(session.ciphertext).toEqual(web.file)
    expect(session.vaultText).toBe(web.toVaultText())
  })

  it('lock 幂等，且不覆盖第一个锁定原因', async () => {
    const { session } = await mirrorScene()
    await session.unlock('correct horse battery staple')

    session.lock()
    session.lock('max_lifetime')

    // 原因要是能被后一次调用改写，「会话是空闲超时锁掉的」这条信息就会在某个
    // 调用顺序下变成「已手动锁定」，而用户看到的是完全不同的解释。
    expect(session.status).toEqual({ locked: true, reason: 'manual' })

    // 对没解锁过的会话调用 lock 不改变原因 —— 它本来就是 never_unlocked。
    const locked = await build(createRecordingStore(null), createFakeClock())
    locked.lock()
    expect(locked.status).toEqual({ locked: true, reason: 'never_unlocked' })
  })

  it('解锁不写存储：口令与密钥都没有落盘的地方', async () => {
    const { store, session } = await mirrorScene()
    await session.unlock('correct horse battery staple')
    await session.loadArchive()

    expect(store.writes).toEqual([])
  })

  it('超时不是终止态：过期之后重新解锁即可继续用', async () => {
    const { clock, session } = await mirrorScene()
    await session.unlock('correct horse battery staple')

    clock.advance(DEFAULT_IDLE_TTL_MS + 60_000)
    expect(session.status).toEqual({ locked: true, reason: 'idle_timeout' })

    await session.unlock('correct horse battery staple')
    expect(await session.loadArchive()).toEqual(maximalArchiveV1)
  })
})

describe('B. 超时：两条绳子各管一边', () => {
  it('TTL 之内照常，截止时刻前 1 毫秒仍然解锁', async () => {
    const { clock, session } = await mirrorScene()
    await session.unlock('correct horse battery staple')

    clock.advance(DEFAULT_IDLE_TTL_MS - 1)
    expect(session.status.locked).toBe(false)
  })

  it('截止时刻本身就算过期（边界是 >=，不是 >）', async () => {
    const { clock, session } = await mirrorScene()
    await session.unlock('correct horse battery staple')

    clock.advance(DEFAULT_IDLE_TTL_MS)

    // 「15 分钟 TTL」意味着第 15 分钟整点就不再是有效会话。边界写死，
    // 免得读的人要去猜是 > 还是 >=（改边界会让这条断言红，那正是它的作用）。
    expect(session.status).toEqual({ locked: true, reason: 'idle_timeout' })
  })

  it('惰性过期：期间一次调用都没有，把表拨快 16 分钟 ⇒ 已锁定', async () => {
    const { clock, session } = await mirrorScene()
    await session.unlock('correct horse battery staple')

    // 这一条证明「没有定时器」这件事是可接受的：没有任何人戳它，
    // 过期照样成立 —— 因为过期是**被问到时读一次时间**，不是一个回调。
    // MV3 的 service worker 会在约 30 秒空闲后被杀掉，靠回调的实现会在真实
    // 环境里静默失效（本地怎么测都对），这里从结构上排除了那条路线。
    clock.advance(16 * 60_000)

    expect(session.status).toEqual({ locked: true, reason: 'idle_timeout' })
    expect(await rejectionOf(session.loadArchive())).toBe('vault_locked:idle_timeout')
  })

  it('用户侧访问会续期：每 10 分钟读一次，20 分钟时仍然解锁', async () => {
    const { clock, session } = await mirrorScene()
    await session.unlock('correct horse battery staple')

    clock.advance(10 * 60_000)
    await session.loadArchive()
    clock.advance(10 * 60_000)
    await session.loadArchive()

    const status = session.status
    expect(status.locked).toBe(false)
    if (status.locked) throw new Error('不该锁定')

    // 滑动窗口：截止时刻跟着最后一次使用走。
    expect(status.idleExpiresAt).toBe(clock.now() + DEFAULT_IDLE_TTL_MS)
    expect(status.hardExpiresAt).toBe(status.unlockedAt + DEFAULT_MAX_LIFETIME_MS)
  })

  it('绝对上限：一直在用也到期 —— 空转不能无限延长会话', async () => {
    const { clock, session } = await mirrorScene()
    await session.unlock('correct horse battery staple')

    clock.advance(10 * 60_000)
    await session.loadArchive()
    clock.advance(10 * 60_000)
    await session.loadArchive()

    // 20 分钟：空闲截止已经滑到 35 分钟，所以还活着。
    expect(session.status.locked).toBe(false)

    clock.advance(10 * 60_000) // 恰好 30 分钟

    // 此刻空闲截止还差 5 分钟才到，只有绝对上限断了。
    // **这一条是第二条绳子存在的全部理由**：若只有空闲 TTL，一个持有已解锁
    // 上下文的进程只要每 14 分钟碰一次，就能让密钥永远留在内存里 ——
    // 那时「15 分钟 TTL」就不再是上界，只是一句描述。
    expect(session.status).toEqual({ locked: true, reason: 'max_lifetime' })
  })

  it('两条绳子都断了时报绝对上限（信息量更大的那一条）', async () => {
    const { clock, session } = await mirrorScene()
    await session.unlock('correct horse battery staple')

    clock.advance(40 * 60_000)

    // 处置完全一样（重新解锁），所以比的是信息量：空闲超时是正常使用的一部分，
    // 报它会把「一直在用却还是到期了」这个更少见的情况藏起来。
    expect(session.status).toEqual({ locked: true, reason: 'max_lifetime' })
  })

  it('续期只推空闲截止，绝对截止在解锁时就定死', async () => {
    const { clock, session } = await mirrorScene()
    await session.unlock('correct horse battery staple')

    const first = session.status
    if (first.locked) throw new Error('刚解锁不该是锁定态')

    clock.advance(5 * 60_000)
    await session.loadArchive()

    const second = session.status
    if (second.locked) throw new Error('不该锁定')

    expect(second.idleExpiresAt).not.toBe(first.idleExpiresAt)
    expect(second.hardExpiresAt).toBe(first.hardExpiresAt)
  })

  it('超时参数不是正数就拒绝建会话 —— NaN 会让所有比较为 false（永不过期）', async () => {
    const clock = createFakeClock()
    const store = createRecordingStore(null)

    for (const bad of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      expect(
        await rejectionOf(
          ExtensionVaultSession.create({
            store,
            transport: createMemoryTransport(),
            clock,
            idleTtlMs: bad,
          }),
        ),
      ).toBe('invalid_options:-')
    }
  })

  it('五种锁定原因各有各的话说（两种状态不能显示同一句话）', () => {
    const reasons: LockReason[] = [
      'never_unlocked',
      'manual',
      'idle_timeout',
      'max_lifetime',
      'key_changed',
    ]

    const messages = reasons.map(describeLockReason)

    expect(new Set(messages).size).toBe(reasons.length)
    for (const message of messages) expect(message.length).toBeGreaterThan(0)
  })
})

describe('C. 重启：密钥活不过一次重启', () => {
  it('重启后必须重新解锁：副本还在，但读不到内容', async () => {
    const { web, store, clock, session } = await mirrorScene()
    const passphrase = 'correct horse battery staple'

    await session.unlock(passphrase)
    expect(await session.loadArchive()).toEqual(maximalArchiveV1)
    session.lock('manual')

    // 重启 = 用同一份存储建一个新会话。新旧会话之间没有任何共享的引用，
    // 所以「密钥还在不在」不是靠某处代码把它清掉，而是**根本没有地方能存它**：
    // 本模块唯一的落盘出口是注入的 store，而它的每一次写入都被 `store.writes`
    // 记着 —— `security.test.ts` 里那条断言把这件事钉死。
    const restarted = await build(store, clock)

    expect(restarted.status).toEqual({ locked: true, reason: 'never_unlocked' })
    expect(restarted.vaultText).toBe(web.toVaultText())
    expect(await rejectionOf(restarted.loadArchive())).toBe('vault_locked:never_unlocked')

    await restarted.unlock(passphrase)
    expect(await restarted.loadArchive()).toEqual(maximalArchiveV1)
  })

  it('两个会话互不影响：锁掉一个不会动另一个', async () => {
    const { store, clock, session } = await mirrorScene()
    const passphrase = 'correct horse battery staple'

    await session.unlock(passphrase)
    const other = await build(store, clock)
    await other.unlock(passphrase)

    session.lock()

    // 密钥是**每个会话对象各自持有**的。这条断言排掉了「把 DEK 存在某个
    // 模块级变量里」这种实现 —— 那种实现下，两个会话会共享同一份密钥，
    // 一个锁定就等于全部锁定（或者更糟：锁不掉）。
    expect(await other.loadArchive()).toEqual(maximalArchiveV1)
    expect(session.status.locked).toBe(true)
  })

  it('重启后换一份档案解锁：读到的就是新的那份（副本是存储说了算）', async () => {
    const { web, store, clock } = await mirrorScene()

    await web.saveArchive(emptyArchiveV1())

    const restarted = await build(store, clock)
    // 存储里还是启动时那份（没人推过），所以扩展看到的是旧内容 ——
    // 这正是推送通道存在的理由，也是下一条（mirror.test.ts）要测的东西。
    await restarted.unlock('correct horse battery staple')
    expect(await restarted.loadArchive()).toEqual(maximalArchiveV1)

    await restarted.applyPush(web.toVaultText())
    expect(await restarted.loadArchive()).toEqual(emptyArchiveV1())
  })
})
