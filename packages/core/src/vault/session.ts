/**
 * 密文库会话 —— 「一个已经用口令打开的密文库」。
 *
 * ```
 *                         ┌─ 落盘的东西（session.file）───────────────┐
 * 口令 ──Argon2id──► KEK ─┤ wrappedKey │ payload │ kdf │ cipher │ver. │
 *                         └───────────────────────────────────────────┘
 *                                   ▲
 *                     session.#dek ─┘（只在内存里，lock() 时清零）
 * ```
 *
 * **为什么是一个对象而不是一组纯函数。** 现有 crypto 层全是纯函数，
 * 但密文库有一个别处没有的东西：**一个需要被显式结束的生命周期**。
 * 数据密钥必须在某几个时刻从内存里消失（用户点「锁定」、会话超时、标签页关闭），
 * 而「函数返回值」没有「消失」这个操作。把它做成对象，`lock()` 才有一个明确的落点，
 * 「谁负责清掉密钥」也才有唯一的答案。
 *
 * **该类刻意保持薄。** 所有密码学都在 `crypto` 层，这里只负责编排顺序 ——
 * 因此下面每个方法的行为都可以用「它调了哪几个原语、按什么顺序」完整描述，
 * 对照 `envelope.ts` 的 AAD 注释即可推导出安全性，不需要读第二遍源码。
 *
 * 四条不变量：
 *   ① `file` 永远只含密文，**任何时刻都不含明文**；明文也不在会话里缓存。
 *   ② 锁定后除 `file` / `toVaultText` 外的所有操作都抛 `vault_locked`。
 *   ③ 换口令**不改变** `payload` 的任何一个字节。
 *   ④ `open` 成功 ⇒ 内容完好可读。（口令对**且**档案没坏，才是「解锁成功」。）
 */
import {
  AEAD_ALGORITHM,
  CryptoError,
  DEFAULT_KDF_PARAMS,
  ENVELOPE_FORMAT,
  ENVELOPE_VERSION,
  KEY_BYTES,
  bytesToUtf8,
  createEnvelopeHeader,
  kdfParamsOf,
  openPayload,
  parseEnvelopeFile,
  randomBytes,
  sealPayload,
  unwrapDek,
  utf8ToBytes,
  wrapDek,
  type EncryptedEnvelope,
  type EnvelopeKdf,
  type KdfParams,
} from '../crypto/index'
import { deserializeArchive, emptyArchiveV1, serializeArchive, type ArchiveV1 } from '../schema/index'

import { serializeVaultFile } from './backup'

export interface CreateVaultOptions {
  /**
   * 覆盖 KDF 参数。**生产路径不要传** —— 默认取 `DEFAULT_KDF_PARAMS`
   * （m=64 MiB / t=3 / p=1，依据见 `crypto/params.ts`）。测试传低参数只是为了快。
   */
  readonly params?: KdfParams
  /** 初始档案，默认一份空档案。 */
  readonly archive?: ArchiveV1
}

export class Vault {
  /** 数据密钥。`null` 表示已锁定。 */
  #dekBytes: Uint8Array | null

  /** 密文。可落盘、可导出、可推送给扩展 —— 不含任何明文。 */
  #encrypted: EncryptedEnvelope

  private constructor(dekBytes: Uint8Array | null, encrypted: EncryptedEnvelope) {
    this.#dekBytes = dekBytes
    this.#encrypted = encrypted
  }

  /**
   * 新建一个密文库，并用给定口令立即解锁。
   *
   * 新库携带一份**空档案**而不是「没有内容」：档案 schema 要求对象形状完整，
   * 而「空库」与「内容为空的库」在用户眼里是同一件事 —— 分两种状态
   * 只会让每个读取路径都要处理「还没有档案」的分支。
   */
  static async create(passphrase: string, options: CreateVaultOptions = {}): Promise<Vault> {
    const header = await createEnvelopeHeader(options.params ?? DEFAULT_KDF_PARAMS)
    const dekBytes = await randomBytes(KEY_BYTES)

    try {
      const plaintext = await utf8ToBytes(
        serializeArchive(options.archive ?? emptyArchiveV1()),
      )

      const encrypted: EncryptedEnvelope = {
        format: ENVELOPE_FORMAT,
        version: ENVELOPE_VERSION,
        kdf: header,
        cipher: { algorithm: AEAD_ALGORITHM },
        wrappedKey: await wrapDek(header, dekBytes, passphrase),
        payload: await sealPayload(dekBytes, plaintext),
      }

      return new Vault(dekBytes, encrypted)
    } catch (error) {
      // 只在中途失败时清理。成功路径必须把 dek 交给新会话继续持有，
      // 否则「创建成功但立刻是锁定状态」——一个自相矛盾的结果。
      dekBytes.fill(0)
      throw error
    }
  }

  /**
   * 用口令打开一份已有的密文（来自存储，或用户导入的 `.vault` 文件）。
   *
   * `file` 声明为 `unknown` 而不是 `EncryptedEnvelope`：这份数据可能来自任何地方，
   * **校验必须发生在最靠近数据的地方**，而不是依赖调用方记得先校验过。
   * 口令错或文件被改过都会抛 `decryption_failed`，不会返回任何对象。
   */
  static async open(file: unknown, passphrase: string): Promise<Vault> {
    const record = parseEnvelopeFile(file)

    // 失败在此抛出时 dekBytes 尚未分配出去，无需清理。
    const dekBytes = await unwrapDek(record.kdf, record.wrappedKey, passphrase)

    try {
      // **立即验一次内容**，让「解锁成功」等价于「数据完好可读」。
      //
      // 不这么做的话，解出口令只能证明「密钥封装没坏」：一个 payload 被
      // 篡改过的文件会「解锁成功」，然后在读取时失败 —— 用户先被告知
      // 「口令正确」，再被告知「档案损坏」，两次惊吓换不来任何好处。
      //
      // 代价是内容会被解密两次（这里一次、`loadArchive` 一次）。这是刻意的：
      // 宁可多解一次，也不把明文缓存在会话里等着被读 —— 缓存的明文会一直
      // 待在内存中，直到有人记得清掉它，而「有人记得」从来不是可靠的设计依据。
      //
      // 内容由 AEAD 保护，这一步顺带成了篡改检测的最早时机。
      await openPayload(dekBytes, record.payload)
    } catch (error) {
      dekBytes.fill(0)
      throw error
    }

    return new Vault(dekBytes, record)
  }

  /** 密文。**读它不需要解锁** —— 它本来就是给磁盘和网络看的。 */
  get file(): EncryptedEnvelope {
    return this.#encrypted
  }

  get isLocked(): boolean {
    return this.#dekBytes === null
  }

  /** 导出为 `.vault` 文本。这是备份的唯一形态，也是唯一能离开本机的形态。 */
  toVaultText(): string {
    return serializeVaultFile(this.#encrypted)
  }

  /** 解出档案全文。 */
  async loadArchive(): Promise<ArchiveV1> {
    const dekBytes = this.#requireDek()
    const plaintext = await openPayload(dekBytes, this.#encrypted.payload)

    let text: string
    try {
      text = await bytesToUtf8(plaintext)
    } catch {
      throw new CryptoError('malformed_envelope', '解密结果不是合法 UTF-8 文本')
    }

    try {
      return deserializeArchive(text)
    } catch (cause) {
      throw new CryptoError('malformed_envelope', `解密出的内容不是合法档案：${String(cause)}`)
    }
  }

  /**
   * 保存档案。
   *
   * 只重做 `payload` —— **盐、KDF 参数与被封装的 DEK 全部不动**。
   * 盐的作用域是「口令 → KEK」，保存内容与口令无关；每次保存都换盐
   * 只会让同一份数据在不同时刻产生互不兼容的中间态，没有任何安全性收益。
   *
   * 注意 `serializeArchive` 内部会先过一遍 schema：不合法的档案
   * 不会有机会被写进密文，而是在这里就抛错。
   */
  async saveArchive(archive: ArchiveV1): Promise<void> {
    const dekBytes = this.#requireDek()
    const payload = await sealPayload(dekBytes, await utf8ToBytes(serializeArchive(archive)))
    this.#encrypted = { ...this.#encrypted, payload }
  }

  /**
   * 换口令。
   *
   * 这是两层密钥设计（KEK 封装 DEK，DEK 加密内容）的**唯一兑现点**：
   * 只生成新盐、重新派生 KEK、重新封装 DEK。
   * `payload` 逐字节原样保留 —— 内容由 DEK 加密，而 DEK 没有变。
   *
   * KDF 参数沿用**原文件里的**而不是当前生产默认值：换口令是一次
   * 用户意图明确、范围明确的操作，顺手把加密强度也升上去会让
   * 「这次改动到底改了什么」变得说不清。参数升级应当是独立的一次迁移。
   *
   * 失败时状态不变：`wrapDek` 抛错发生在赋值之前。
   */
  async changePassphrase(nextPassphrase: string): Promise<void> {
    const dekBytes = this.#requireDek()
    const header: EnvelopeKdf = await createEnvelopeHeader(kdfParamsOf(this.#encrypted.kdf))
    const wrappedKey = await wrapDek(header, dekBytes, nextPassphrase)

    this.#encrypted = { ...this.#encrypted, kdf: header, wrappedKey }
  }

  /**
   * 锁定：把数据密钥从内存里清掉。
   *
   * 幂等 —— 重复调用不抛错。调用方（用户点锁定、会话超时、页面卸载）
   * 不需要先问「现在是不是已经锁了」，这种前置检查最终一定会有人写错。
   *
   * 关于清零的**诚实说明**：`fill(0)` 只覆盖我们持有的那一块缓冲区。
   * JS 的 GC、结构化克隆、以及 wasm 内存都可能已经复制过这些字节，
   * 所以这不是一道安全保证，只是缩短密钥在堆上可被扫描到的窗口 ——
   * 与 `envelope.ts` 里 `finally { dek.fill(0) }` 的尺度一致。
   * 加密本身不依赖这一点，锁定的**行为**保证（下面 `#requireDek`）才是真的。
   */
  lock(): void {
    this.#dekBytes?.fill(0)
    this.#dekBytes = null
  }

  #requireDek(): Uint8Array {
    if (this.#dekBytes === null) {
      throw new CryptoError('vault_locked', '密文库已锁定：请先用口令解锁再读写档案')
    }
    return this.#dekBytes
  }
}
