/**
 * 扩展侧密文副本 —— **同一个密文库，在扩展里的第二个会话**。
 *
 * ```
 *  Web 端                                    扩展端（本模块）
 *  ┌──────────────────────┐                  ┌────────────────────────────┐
 *  │ Vault.create(口令)    │                  │ ExtensionVaultSession      │
 *  │   ↓                  │   密文推送        │   ↑ 密文副本（锁定时也可读）│
 *  │ Vault.saveArchive()  │ ───────────────► │   ↓ unlock(口令)            │
 *  │   ↓                  │  （transport）    │ Vault（core，持 DEK）       │
 *  │ toVaultText()        │                  │   ↓ loadArchive()          │
 *  └──────────────────────┘                  └────────────────────────────┘
 *       密钥永远不离开 Web 端的内存                密钥永远不落盘，只活在内存里
 * ```
 *
 * ## 它比 `core/vault` 多出来的东西只有三件
 *
 * 1. **超时**。core 的 `Vault` 只在「用户点了锁定」时锁定；扩展是长期驻留的
 *    上下文，必须自己会过期。两条绳子：空闲 TTL 与绝对上限（见下）。
 * 2. **惰性过期**。没有任何定时器 —— 时间只在「有人来问」的那一刻被读一次。
 *    MV3 的 service worker 会被杀掉，定时器靠不住（详见 `clock.ts`）。
 * 3. **密文副本可以被替换**。Web 端保存档案后推一份新的过来，
 *    扩展必须能安全地判断「这是同一个库的更新，还是另一个库的文件」。
 *
 * 其余一切（怎么解、密钥怎么分层、AAD 绑什么）都交给 core 的 `Vault` ——
 * 本模块一行密码学都不做（AGENTS.md 红线 7）。
 *
 * ## 两条绳子，各管一边
 *
 * | 绳子 | 默认 | 管的是 |
 * |---|---|---|
 * | 空闲 TTL | 15 min 无使用 | 用户走开之后，暴露窗口自然关闭 |
 * | 绝对上限 | 30 min（自解锁起算） | 「一直有人在用它」不能无限期延长会话 |
 *
 * **为什么必须有第二条。** 只有空闲 TTL 的话，一个持有已解锁扩展的上下文
 * 只要每 14 分钟碰一次，就能让密钥永远留在内存里 —— 那时「15 分钟 TTL」
 * 就不再是一条上界，只是一句描述。绝对上限把它变回上界：
 * 每次解锁最多活 30 分钟，之后无论多活跃都要重新输一次口令。
 *
 * 上限取 2 × 空闲 TTL 而不是更大：它的作用是**封顶**，不是照顾长表单。
 * 真正需要长时间连续填写时，用户重新输一次口令的成本是一次口令输入，
 * 而暴露窗口的上界从「无限」降到 30 分钟。
 *
 * ## 时间的读法（这条决定了超时能不能被信任）
 *
 * 每次访问都做一次 `now >= 截止时刻 ⇒ 锁定`，**没有定时器、没有后台任务**。
 * 于是「什么时候会过期」只取决于两件事：注入的时钟，和上一次使用时刻。
 * 测试里把表拨快 16 分钟即可复现，不需要等待（也因此不会闪断）。
 * 截止时刻本身算过期（`>=`）：`ttl = 15min` 意味着「第 15 分钟整就不是有效会话了」，
 * 边界写清楚，免得读的人要去猜是 `>` 还是 `>=`。
 *
 * ## 关于 15 分钟这个数字从哪里来
 *
 * TASKS.md T1.5 写的是「会话内 15min TTL」。本实现把它兑现成**空闲超时**，
 * 并补了一条 2× 的绝对上限（见上）。选择「空闲」而不是「从解锁起算的绝对 15 分钟」，
 * 因为真实的填充动作是「断断续续地读表单、想字段、填、检查」，中途被锁在最难看的
 * 时刻（表单填到一半）会让人开始把口令写在便签上 —— **那才是真正的安全损失**。
 * 这个偏离与它的代价一并记在 TASKS.md T1.5 的注里。
 */
import type { EncryptedEnvelope } from '../../../core/src/crypto/index'
import type { ArchiveV1 } from '../../../core/src/schema/index'
import { Vault, parseVaultFile, type VaultStore } from '../../../core/src/vault/index'

import { type Clock, systemClock } from './clock'
import { ExtensionVaultError, describeLockReason, type LockReason } from './errors'
import type { CiphertextTransport, CiphertextUnsubscribe } from './transport'

/** 默认空闲超时：15 分钟没有使用即锁定。 */
export const DEFAULT_IDLE_TTL_MS = 15 * 60_000

/** 默认绝对上限：一次解锁最多活 30 分钟（2 × 空闲 TTL）。 */
export const DEFAULT_MAX_LIFETIME_MS = 30 * 60_000

export interface ExtensionVaultOptions {
  /** 密文副本存哪儿。core 的 `VaultStore`（读 / 写 / 删三个方法）。 */
  readonly store: VaultStore
  /** 密文推送从哪儿来。 */
  readonly transport: CiphertextTransport
  /** 时钟。默认 `systemClock`；测试注入可控时钟。 */
  readonly clock?: Clock
  /** 空闲超时（毫秒）。默认 15 分钟。改动请连同理由一起改这条注释。 */
  readonly idleTtlMs?: number
  /** 绝对上限（毫秒）。默认 30 分钟。**不要设成 `Infinity`**：那样空闲超时就不再是上界。 */
  readonly maxLifetimeMs?: number
}

export type SessionStatus =
  | { readonly locked: true; readonly reason: LockReason }
  | {
      readonly locked: false
      readonly unlockedAt: number
      /** 空闲截止时刻（每次用户侧访问后向后滑动）。 */
      readonly idleExpiresAt: number
      /** 绝对截止时刻（解锁时定下，不再变动）。 */
      readonly hardExpiresAt: number
    }

/** 推送被拒的原因。 */
export type PushRejection =
  /** 不是合法的信封（或者压根不是密文 —— 例如把一份明文档案推了进来）。 */
  | 'malformed_ciphertext'
  /**
   * 结构合法，但手里的 DEK 打不开它的内容 ⇒ 这不是同一个库。
   *
   * 与 core 的 `decryption_failed` 一样**故意粗粒度**：「密文被改过」与
   * 「这是另一个库」在 AEAD 的数学上不可区分，硬要分开只能泄漏信息。
   */
  | 'ciphertext_mismatch'

export interface PushOutcome {
  /** 密文是否被采纳。`false` 表示会话里的副本与存储里的内容**一个字节都没动**。 */
  readonly accepted: boolean
  /** 采纳之后密文是否真的换了（逐字相同的重复推送 ⇒ `false`）。 */
  readonly changed: boolean
  /** 未采纳的原因；采纳时为 `null`。 */
  readonly rejection: PushRejection | null
  /** 采纳之后会话**因为这次推送**被锁定时（密钥封装代际变了）为 `true`。 */
  readonly relocked: boolean
  /**
   * 这次推送的密钥封装代际与旧副本不同 —— **仅供参考，不参与采纳判定**。
   *
   * 锁定时它与 `relocked` 的区别是：锁定态的会话没有密钥可判同源，
   * 只能采纳，于是它给调用方一个线索 —— 「下次解锁若提示口令错误，
   * 先确认 Web 端是不是改过口令」，而不是让用户以为是自己记错了。
   */
  readonly keyGenerationChanged: boolean
}

/**
 * 密钥封装代际 —— 「解 payload 用的那把密钥，是怎么被封装进来的」。
 *
 * 内容保存（core 的 `saveArchive`）只换 `payload`，因此代际**不变**；
 * 换口令会同时换盐与 `wrappedKey`，代际随之改变。所以它回答的是
 * 「有人重新封装过这把密钥吗」，而不是「内容变了没有」。
 *
 * 确定性拼接而不是 `JSON.stringify`：键顺序一变，同一个文件就会算出两个代际
 * （与 core 的 `dekBinding` 同一条理由）。
 */
function keyGenerationOf(file: EncryptedEnvelope): string {
  return [
    file.kdf.algorithm,
    String(file.kdf.memoryKiB),
    String(file.kdf.iterations),
    String(file.kdf.parallelism),
    String(file.kdf.keyLength),
    file.kdf.salt,
    file.cipher.algorithm,
    file.wrappedKey.nonce,
    file.wrappedKey.ciphertext,
  ].join('|')
}

function noChange(): PushOutcome {
  return {
    accepted: true,
    changed: false,
    rejection: null,
    relocked: false,
    keyGenerationChanged: false,
  }
}

function rejected(rejection: PushRejection, keyGenerationChanged = false): PushOutcome {
  return { accepted: false, changed: false, rejection, relocked: false, keyGenerationChanged }
}

export class ExtensionVaultSession {
  #store: VaultStore
  #transport: CiphertextTransport
  #clock: Clock
  #idleTtlMs: number
  #maxLifetimeMs: number

  /** 密钥持有者。`null` = 锁定（与 core 的 `Vault` 同一个约定）。 */
  #vault: Vault | null = null

  /** 密文副本。**锁定态下依然可读** —— 它本来就是给磁盘和网络看的东西。 */
  #ciphertext: EncryptedEnvelope | null = null

  /** 副本的原始文本。落盘与「逐字相同」判定都以它为准（不是重新序列化出来的）。 */
  #ciphertextText: string | null = null

  #generation: string | null = null
  #unlockedAt = 0
  #lastUsedAt = 0
  #lockReason: LockReason = 'never_unlocked'

  /**
   * 推送串行化。
   *
   * 两次推送交错会让「存储里是哪一份」与「会话认为的是哪一份」脱钩 ——
   * 慢的那次后写入，覆盖掉快的那次，而后者才是真正的新版本。
   * 用一条 Promise 链把它们排成一队，这类交错就不可能发生。
   */
  #queue: Promise<unknown> = Promise.resolve()

  private constructor(options: ExtensionVaultOptions) {
    this.#store = options.store
    this.#transport = options.transport
    this.#clock = options.clock ?? systemClock
    this.#idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS
    this.#maxLifetimeMs = options.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS

    // `Number.isFinite` 而不是只判 `> 0`：`Infinity` 满足「大于 0」，
    // 而它恰好等于**没有上界** —— 那条上界正是第二条绳子存在的全部意义，
    // 放它过去等于把两条绳子悄悄换成一条。
    const positive = (value: number): boolean => Number.isFinite(value) && value > 0

    if (!positive(this.#idleTtlMs) || !positive(this.#maxLifetimeMs)) {
      // 0 或负数会让「一解锁就过期」，NaN 与 Infinity 更坏：前者让所有比较都变成
      // false（**永不过期**），后者是「永不过期」的另一种写法。
      // 用 `Number.isFinite` 一并拦掉，是因为坏配置里最危险的一类从来不是
      // 「报错」，而是「看起来在工作」—— 测试全绿，而密码学上等于没有超时。
      throw new ExtensionVaultError(
        'invalid_options',
        `超时参数必须是有限正数：idleTtlMs=${this.#idleTtlMs}, maxLifetimeMs=${this.#maxLifetimeMs}`,
      )
    }
  }

  /**
   * 建一个扩展会话，并把存储里现有的密文副本读进来。
   *
   * 读进来**不等于**解锁：新会话的密钥是空的，必须再输一次口令。
   * 这一点是扩展重启后的全部行为（TASKS.md T1.5 第二条），
   * 也由 `security.test.ts` 里那条「存储里从头到尾只有密文」的断言兜着 ——
   * 密钥没有地方能活过一次重启。
   */
  static async create(options: ExtensionVaultOptions): Promise<ExtensionVaultSession> {
    const session = new ExtensionVaultSession(options)
    await session.refreshFromStore()
    return session
  }

  // ─────────────────────────── 副本 ───────────────────────────

  /** 当前的密文副本。读它**不需要解锁**。 */
  get ciphertext(): EncryptedEnvelope | null {
    return this.#ciphertext
  }

  /** 当前的密文副本（`.vault` 文本原文）。同样不需要解锁。 */
  get vaultText(): string | null {
    return this.#ciphertextText
  }

  /** 从存储里拉一次最新密文（service worker 重新醒来时用）。 */
  async refreshFromStore(): Promise<PushOutcome> {
    const text = await this.#store.read()

    // `null` 表示存储里什么都没有。这里**不**顺手把会话里的副本也清掉：
    // 「存储一时读不到」与「用户删了库」在这里无法区分，而清掉副本是不可逆的 ——
    // 抹除密文库是 core 的 `eraseVault`，它有明确的一次调用，不该由一次读空触发。
    if (text === null) return noChange()

    // `persist = false`：这段文本**本来就来自存储**，没有理由再写回去。
    // 一次多余的写入不只是浪费 —— 它会触发一次存储变更回声，于是「启动时读一次」
    // 会变成一次无意义的写入 + 一次回声。
    return this.#enqueue(text, false)
  }

  /**
   * 处理一份**外部推来**的密文（采纳后写回存储，让重启后也能拿到最新副本）。
   *
   * 判定逻辑在 `#applyPush`：四步，顺序不可换。
   * 这里只负责排队 —— 两次推送交错会让「存储里是哪一份」与「会话认为的是哪一份」
   * 脱钩（慢的那次后写入，覆盖掉快的、但更新的那次）。
   */
  applyPush(text: string): Promise<PushOutcome> {
    return this.#enqueue(text, true)
  }

  /**
   * 排队并处理。`persist` 决定采纳之后要不要把这份文本写回存储 ——
   * 只有**外部推来**的密文需要（存储里那份还是旧的）；从存储里读来的那份不需要。
   */
  #enqueue(text: string, persist: boolean): Promise<PushOutcome> {
    // 幂等快路径必须放在**排队之前**。
    //
    // 否则会形成一个环：我们写存储 → 存储触发变更回声 → 回声再次进入队列，
    // 而队列要等第一次推送结束、第一次推送又在等存储写完 —— 同步回声时直接死锁。
    // 放在队列前，回声在第一个 `await` 之前就返回，环从结构上不存在。
    // （副作用是这条快路径对**同步**回声也成立，不只是 Chrome 的异步回调。）
    if (text === this.#ciphertextText) return Promise.resolve(noChange())

    const next = this.#queue.then(() => this.#applyPush(text, persist))
    // 链条不能因为某一次失败而断掉：一次推送出错不该让后续推送全部静默失效。
    this.#queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /**
   * 采纳判定的全部逻辑。四步，顺序不可换：
   *
   * 1. **逐字相同 ⇒ 什么都不做。** 存储变更会回声（我们写存储这件事本身
   *    也会触发一次变更通知），没有这一条，一次保存会引发一次无意义的写入。
   * 2. **结构校验。** 失败 ⇒ 拒绝。**不写存储** —— 一份坏文件写进去，
   *    下一次解锁会以 `decryption_failed` 的形式表现出来，而那时的提示是
   *    「口令错」，与真实原因（副本是坏的）完全对不上，用户会开始怀疑自己记错口令。
   * 3. **同源判定（仅已解锁时）。** 用手里这把 DEK 试着解新 `payload`：
   *    解得开 ⇒ 同一个库，采纳；解不开 ⇒ 另一个库的文件，拒绝并保留原副本。
   * 4. **代际变了就主动降级为锁定**（理由见下面那一段）。
   */
  async #applyPush(text: string, persist: boolean): Promise<PushOutcome> {
    // 排队期间可能已经有另一份同文本的推送被处理完了（两次相同推送一起进来）。
    if (text === this.#ciphertextText) return noChange()

    let file: EncryptedEnvelope
    try {
      file = parseVaultFile(text)
    } catch {
      return rejected('malformed_ciphertext')
    }

    const generation = keyGenerationOf(file)
    const generationChanged = this.#generation !== null && generation !== this.#generation

    let relock = false

    if (this.#vault !== null) {
      // 判决性的一步：解得开就是同一个库。**不要**退化成「比较盐 / wrappedKey」——
      // 换口令会同时换掉这两样，于是「头部不同」在两种真实情形里都成立，
      // 而它们该被区别对待（同源 ⇒ 采纳并提示重新解锁；异源 ⇒ 拒绝并保留原副本）。
      //
      // 代价：这里会把推来的内容完整解一遍，而结果只用来回答「是不是我们的」。
      // 推送频率是「用户点一次保存」，不是每帧，所以这个代价不需要优化 ——
      // 换来的是判据从启发式变成密码学上的等价关系。
      try {
        await this.#vault.loadPayload(file.payload)
      } catch {
        return rejected('ciphertext_mismatch', generationChanged)
      }

      // 同源，但密钥封装代际变了 ⇒ 有人重新封装过 DEK（Web 端改了口令）。
      // 此时的处境是：**内容我们读得懂，而解锁路径我们验不了** ——
      // 新的 `wrappedKey` 能不能被（新）口令解开，手里没有口令，无从判断。
      // 拿一份「解锁路径无法验证」的副本继续干活，会在某次重启后炸在最糟的时刻，
      // 而且表现成「口令错误」。所以这里主动降级：代价是一次口令输入，
      // 换来的是「手里的副本一定是能被口令打开的」这条性质继续保持成立。
      relock = generationChanged
    }

    // 顺序有讲究：先把会话的视图切过去，再写存储。
    // 写存储会触发一次变更回声，回声进来时命中上面那条幂等分支，于是循环只有一次。
    this.#ciphertext = file
    this.#ciphertextText = text
    this.#generation = generation

    if (persist) await this.#store.write(text)

    if (relock) this.lock('key_changed')

    return {
      accepted: true,
      changed: true,
      rejection: null,
      relocked: relock,
      keyGenerationChanged: generationChanged,
    }
  }

  /** 订阅推送。返回取消订阅的函数。 */
  listen(): CiphertextUnsubscribe {
    return this.#transport.subscribe(async (text) => {
      // 推送回调在事件循环里被调用，抛出去没有人能接住 —— 一次落盘失败
      // 不该变成一条 unhandled rejection，也不该让订阅链断掉。
      await this.applyPush(text).catch(() => undefined)
    })
  }

  // ─────────────────────────── 会话 ───────────────────────────

  get status(): SessionStatus {
    this.#expireIfDue()

    if (this.#vault === null) return { locked: true, reason: this.#lockReason }

    return {
      locked: false,
      unlockedAt: this.#unlockedAt,
      idleExpiresAt: this.#lastUsedAt + this.#idleTtlMs,
      hardExpiresAt: this.#unlockedAt + this.#maxLifetimeMs,
    }
  }

  /**
   * 用口令解锁扩展侧的副本。**口令不被保存**，解锁后留在内存里的只有 DEK。
   *
   * 失败时抛 core 的 `CryptoError`：
   *   - `decryption_failed` 口令错，或副本被改过
   *   - `invalid_params`    口令是空串 / 不是字符串
   *   - `malformed_envelope` 副本结构坏了（正常路径上不会发生：进副本前已校验过）
   *
   * 失败后会话**保持锁定**，不留半开状态。
   */
  async unlock(passphrase: string): Promise<void> {
    const file = this.#ciphertext

    if (file === null) {
      throw new ExtensionVaultError(
        'no_ciphertext',
        '扩展里还没有密文副本：先在 Web 端建档或导入 .vault 备份，再回来解锁',
      )
    }

    // `Vault.open` 内部会先过一遍 `parseEnvelopeFile`（在数据边界处校验），
    // 再解 `wrappedKey`，最后**多解一次 payload** 确认内容完好 ——
    // 所以「解锁成功」在这里同样等价于「内容读得出来」。
    const vault = await Vault.open(file, passphrase)

    this.#vault = vault
    this.#unlockedAt = this.#clock.now()
    this.#lastUsedAt = this.#unlockedAt
  }

  /**
   * 解出档案全文。这是**用户侧访问**，会把空闲截止时刻向后滑动。
   *
   * 到期后不返回任何东西：先 `#expireIfDue()` 再取密钥，
   * 所以「过期」不会表现成「读到一份旧档案」，而是明确抛 `vault_locked`。
   */
  async loadArchive(): Promise<ArchiveV1> {
    this.#expireIfDue()
    const vault = this.#requireUnlocked()

    // **读的是镜像里此刻的那份 payload，不是解锁时刻那一份。**
    // 这是「推送刷新」能真正生效的地方：`Vault` 在这里只提供密钥，
    // 内容的真相在 `#ciphertext`。
    //
    // T1.5 的第一版写的是 `vault.loadArchive()` —— 于是推送被接受、存储被更新、
    // `status` 一切正常，而用户读到的还是旧档案：一次**静默失效**，
    // 症状是「刷新好像没生效」而没有任何报错。是 `mirror.test.ts` 里那条
    // 「推送之后扩展读到新内容」把它逼出来的。
    const file = this.#ciphertext
    if (file === null) {
      // 不可达：解锁的前提是有副本，而副本只会被替换、不会被清空。
      // 留着这个分支只是为了让类型收敛，不是为了处理一种真实状态。
      throw new ExtensionVaultError('no_ciphertext', '扩展里还没有密文副本')
    }

    const archive = await vault.loadPayload(file.payload)

    // 只有成功的读取才续期；失败不续期。
    this.#lastUsedAt = this.#clock.now()
    return archive
  }

  /**
   * 锁定：把 DEK 从内存里清掉，并记下**第一个**原因。
   *
   * 幂等 —— 已经锁定时调用它不会覆盖原因。原因要是被后一次调用改写，
   * 「会话是空闲超时锁掉的」这条信息就可能在某个调用顺序下变成
   * 「已手动锁定」，而用户看到的是完全不同的解释。
   */
  lock(reason: LockReason = 'manual'): void {
    if (this.#vault === null) return

    this.#vault.lock()
    this.#vault = null
    this.#unlockedAt = 0
    this.#lastUsedAt = 0
    this.#lockReason = reason
  }

  /** 惰性过期：把时间读出来比一次。**没有任何定时器参与这件事。** */
  #expireIfDue(): void {
    if (this.#vault === null) return

    const now = this.#clock.now()

    // 绝对上限优先。两条绳子都断了的时候报哪一条？
    // 处置完全一样（重新解锁），所以比的是信息量：空闲超时是正常使用的一部分，
    // 报它会把「一直在用却还是到期了」这个更少见、更值得注意的情况藏起来。
    if (now >= this.#unlockedAt + this.#maxLifetimeMs) {
      this.lock('max_lifetime')
      return
    }

    // **截止时刻本身就算过期**（`>=` 而不是 `>`）。
    if (now >= this.#lastUsedAt + this.#idleTtlMs) {
      this.lock('idle_timeout')
    }
  }

  #requireUnlocked(): Vault {
    if (this.#vault === null) {
      // 与 core 同一条理由：把「忘了先解锁 / 已经超时」报成「口令错误」，
      // 用户会开始怀疑自己记错口令 —— 那是完全相反的处置方向。
      throw new ExtensionVaultError(
        'vault_locked',
        `${describeLockReason(this.#lockReason)}：请先用口令解锁再读取档案`,
        this.#lockReason,
      )
    }
    return this.#vault
  }
}
