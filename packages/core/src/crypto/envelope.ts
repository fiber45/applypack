/**
 * 加密信封：一个自包含、可落盘、可导出的密文文件。
 *
 * ```
 * ┌─ 明文头部（受 AAD 保护，改一个字节就解不开） ─────────────────┐
 * │ format / version / kdf{算法, 参数, 盐} / cipher{algorithm}    │
 * └──────────────────────────────────────────────────────────────┘
 * ├─ wrappedKey  用 KEK 加密的 DEK                                ┤
 * └─ payload     用 DEK 加密的档案 JSON                            ┘
 * ```
 *
 * 四条设计决定：
 *
 * **① 信封是自包含的。** KDF 参数与盐都在文件里，解密方不需要任何外部配置。
 * 代价是这些字段变成**外部可写**的 —— 于是它们必须被当不可信输入校验
 * （见 `params.ts` 的上限说明）。
 *
 * **② 两层密钥而不是一层。** 口令派生出的 KEK 只用来封装随机 DEK，档案本身由 DEK 加密。
 * 这样**换口令只需重新封装 DEK，不必重写内容** —— T1.3 的口令重设与增量录入都依赖这一点。
 *
 * **③ 两条 AAD 的作用域刻意不同。**
 * `wrappedKey` 的 AAD 绑定整个头部（含盐与 KDF 参数）：这些字段决定 KEK 怎么算出来，
 * 必须焊死。`payload` 的 AAD 则**只绑定「如何解释这份密文」**（格式 / 版本 / 算法），
 * **故意不含盐**。理由是 ② 的直接推论：换口令必然换盐，而 payload 由 DEK 加密、
 * 与盐毫无关系 —— 若把盐绑进 payload 的 AAD，换口令就等于让内容永久解不开，
 * DEK 分层就白做了。这不是理论问题，是实现 T1.3 时被真实撞到的一道墙。
 *
 * **④ 本文件同时是「一次性加解密」和「可组合原语」两个层次。**
 * `sealArchive` / `openArchive` 是最常用的整包操作；下面导出的
 * `createEnvelopeHeader` / `wrapDek` / `unwrapDek` / `sealPayload` / `openPayload`
 * 是它的分解，`vault` 层（T1.3）需要重排这些步骤来实现「只换口令、不碰内容」。
 * 两个层次共用同一套 AAD 构造，因此不可能出现「整包能解、重排后解不开」的偏差。
 */
import { z } from 'zod'

import { deserializeArchive, serializeArchive, type ArchiveV1 } from '../schema/index'
import { describeZodIssues } from '../schema/zod-issues'
import { aeadOpen, aeadSeal, type SealedBox } from './aead'
import { base64ToBytes, bytesToBase64, bytesToUtf8, randomBytes, utf8ToBytes } from './bytes'
import { CryptoError } from './errors'
import { deriveKek } from './kdf'
import {
  AEAD_ALGORITHM,
  DEFAULT_KDF_PARAMS,
  KDF_SALT_BYTES,
  KEY_BYTES,
  SUPPORTED_AEAD_ALGORITHMS,
  assertKdfParams,
  type KdfParams,
} from './params'

export const ENVELOPE_FORMAT = 'applypack-vault'
export const ENVELOPE_VERSION = 1

export interface EnvelopeKdf {
  readonly algorithm: 'argon2id'
  readonly memoryKiB: number
  readonly iterations: number
  readonly parallelism: number
  readonly keyLength: number
  readonly salt: string
}

export interface EnvelopeSealedBox {
  readonly nonce: string
  readonly ciphertext: string
}

export interface EncryptedEnvelope {
  readonly format: typeof ENVELOPE_FORMAT
  readonly version: typeof ENVELOPE_VERSION
  readonly kdf: EnvelopeKdf
  readonly cipher: { readonly algorithm: string }
  /** 用 KEK 加密封装的数据密钥（DEK）。 */
  readonly wrappedKey: EnvelopeSealedBox
  /** 用 DEK 加密的档案内容。 */
  readonly payload: EnvelopeSealedBox
}

const sealedBoxSchema = z.strictObject({
  nonce: z.string().min(1),
  ciphertext: z.string().min(1),
})

/**
 * 信封的严格 schema。**刻意用 strictObject：未知字段直接拒绝。**
 * 与档案 schema 同一条理由（DESIGN.md ADR-8）—— 一个没被识别的字段
 * 意味着它没有数据分级、不参与「B 级不出端」判定，也就不能悄悄留在文件里。
 *
 * 注意 `version` 与 `cipher.algorithm` 这里只校验类型，具体是否受支持在后面判断 ——
 * 这样才能把「文件是坏的」和「文件来自更晚的版本 / 用了本实现还不支持的算法」
 * 区分成不同的错误码。
 */
const envelopeSchema = z.strictObject({
  format: z.literal(ENVELOPE_FORMAT),
  version: z.number().int(),
  kdf: z.strictObject({
    algorithm: z.literal('argon2id'),
    memoryKiB: z.number().int(),
    iterations: z.number().int(),
    parallelism: z.number().int(),
    keyLength: z.number().int(),
    salt: z.string().min(1),
  }),
  cipher: z.strictObject({ algorithm: z.string().min(1) }),
  wrappedKey: sealedBoxSchema,
  payload: sealedBoxSchema,
})

// ─────────────────────────────── AAD 构造 ───────────────────────────────

/**
 * `wrappedKey` 的绑定串。
 *
 * 必须**确定性拼接**（而不是 `JSON.stringify` 一个对象）—— 键顺序一变，
 * 同一条记录就解不开了。这里把整个头部（含盐与参数）都拼进去：
 * 这些值决定 KEK，绑定它们是零成本的正确性加固。
 */
function dekBinding(header: EnvelopeKdf): string {
  return [
    ENVELOPE_FORMAT,
    `v${ENVELOPE_VERSION}`,
    'purpose=dek',
    header.algorithm,
    String(header.memoryKiB),
    String(header.iterations),
    String(header.parallelism),
    String(header.keyLength),
    header.salt,
  ].join('|')
}

/**
 * `payload` 的绑定串。**常量** —— 这是「换口令不重写内容」的前提。
 *
 * 只绑定「解释这份密文所必需的元数据」：
 *   - `format` / `version`   决定这份文件按哪套规则解释
 *   - `cipher.algorithm`     决定用哪个 AEAD 打开
 *   - `purpose=payload`      防止把 `wrappedKey` 的密文当内容来解（反之亦然）
 *
 * 刻意**不含**盐与 KDF 参数：那些字段只影响 KEK，而 KEK 只用来解 `wrappedKey`。
 * 它们已经通过「KEK 不对 ⇒ DEK 解不出 ⇒ payload 也解不开」这条链被间接保护了，
 * 不需要再进 payload 的 AAD —— 而一旦进去，就会把内容钉死在某一代口令上。
 */
const PAYLOAD_AAD = [ENVELOPE_FORMAT, `v${ENVELOPE_VERSION}`, AEAD_ALGORITHM, 'purpose=payload'].join(
  '|',
)

// ─────────────────────────────── 编解码辅助 ───────────────────────────────

async function encodeBox(box: SealedBox): Promise<EnvelopeSealedBox> {
  return { nonce: await bytesToBase64(box.nonce), ciphertext: await bytesToBase64(box.ciphertext) }
}

async function decodeBox(box: EnvelopeSealedBox): Promise<SealedBox> {
  return { nonce: await base64ToBytes(box.nonce), ciphertext: await base64ToBytes(box.ciphertext) }
}

async function decodeSalt(encoded: string): Promise<Uint8Array> {
  const salt = await base64ToBytes(encoded)
  if (salt.length !== KDF_SALT_BYTES) {
    throw new CryptoError(
      'malformed_envelope',
      `信封里的盐长度必须是 ${KDF_SALT_BYTES} 字节，收到 ${salt.length} 字节`,
    )
  }
  return salt
}

/** 从信封头部取出纯 KDF 参数（丢掉盐）。 */
export function kdfParamsOf(header: EnvelopeKdf): KdfParams {
  return {
    algorithm: header.algorithm,
    memoryKiB: header.memoryKiB,
    iterations: header.iterations,
    parallelism: header.parallelism,
    keyLength: header.keyLength,
  }
}

// ───────────────────────── 原语一：头部与信封结构校验 ─────────────────────────

/**
 * 生成一个全新的信封头部（随机盐）。
 *
 * 只在**新建**或**换口令**时调用。日常保存内容不必换头部 ——
 * 盐的作用域是「口令 → KEK」，与内容无关。
 */
export async function createEnvelopeHeader(
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<EnvelopeKdf> {
  assertKdfParams(params)
  const salt = await randomBytes(KDF_SALT_BYTES)
  return {
    algorithm: params.algorithm,
    memoryKiB: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    keyLength: params.keyLength,
    salt: await bytesToBase64(salt),
  }
}

/**
 * 校验一份「可能是信封」的外部输入，返回规范化后的记录。
 *
 * 失败的四种情形对应四个不同的错误码，调用方（尤其是导入备份的 UI）
 * 需要据此给出不同的提示 —— 把「文件坏了」和「版本太新」混为一谈，
 * 会让用户在一个自己无法解决的问题上反复重试。
 */
export function parseEnvelopeFile(candidate: unknown): EncryptedEnvelope {
  const parsed = envelopeSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new CryptoError(
      'malformed_envelope',
      `信封结构不合法：${describeZodIssues(parsed.error).join('；')}`,
    )
  }
  const record = parsed.data

  if (record.version !== ENVELOPE_VERSION) {
    throw new CryptoError(
      'unsupported_version',
      `信封版本 ${record.version} 不受支持（本实现支持版本 ${ENVELOPE_VERSION}）`,
    )
  }

  if (!SUPPORTED_AEAD_ALGORITHMS.includes(record.cipher.algorithm)) {
    throw new CryptoError('unsupported_algorithm', `不支持的加密算法：${record.cipher.algorithm}`)
  }

  // 参数来自文件，按不可信输入校验 —— 一个 memoryKiB: 4194304 的信封
  // 足以让浏览器在「导入」那一刻尝试分配 4 GiB。
  assertKdfParams(kdfParamsOf(record.kdf))

  // `version` 上面已断言等于 ENVELOPE_VERSION，这里显式收窄类型。
  //
  // 为什么 schema 里不直接写 `z.literal(ENVELOPE_VERSION)`：那样「版本 99 的文件」
  // 会在 safeParse 阶段就失败，被归成 `malformed_envelope` ——
  // 用户看到「文件损坏」，于是他尝试换一个备份文件；而正确的处置是
  // 「这个文件来自更新的版本，请升级工具」。把可诊断的差异磨平，
  // 就等于把用户推向错误的自救方向。
  return { ...record, version: ENVELOPE_VERSION }
}

// ───────────────────────── 原语二：封装 / 解封数据密钥 ─────────────────────────

/** 用口令派生的 KEK 封装 DEK。 */
export async function wrapDek(
  header: EnvelopeKdf,
  dek: Uint8Array,
  passphrase: string,
): Promise<EnvelopeSealedBox> {
  const kek = await deriveKek(passphrase, await decodeSalt(header.salt), kdfParamsOf(header))
  try {
    return await encodeBox(await aeadSeal(kek, dek, await utf8ToBytes(dekBinding(header))))
  } finally {
    kek.fill(0)
  }
}

/** 用口令解出被封装的 DEK。口令错或头部被改，一律 `decryption_failed`。 */
export async function unwrapDek(
  header: EnvelopeKdf,
  wrapped: EnvelopeSealedBox,
  passphrase: string,
): Promise<Uint8Array> {
  const kek = await deriveKek(passphrase, await decodeSalt(header.salt), kdfParamsOf(header))
  try {
    return await aeadOpen(kek, await decodeBox(wrapped), await utf8ToBytes(dekBinding(header)))
  } finally {
    kek.fill(0)
  }
}

// ───────────────────────── 原语三：加密 / 解密内容 ─────────────────────────

/** 用 DEK 加密一段内容。每次调用都换新的随机 nonce。 */
export async function sealPayload(dek: Uint8Array, plaintext: Uint8Array): Promise<EnvelopeSealedBox> {
  return encodeBox(await aeadSeal(dek, plaintext, await utf8ToBytes(PAYLOAD_AAD)))
}

/** 用 DEK 解密内容。 */
export async function openPayload(dek: Uint8Array, payload: EnvelopeSealedBox): Promise<Uint8Array> {
  return aeadOpen(dek, await decodeBox(payload), await utf8ToBytes(PAYLOAD_AAD))
}

// ───────────────────────── 整包：一次加解密一份档案 ─────────────────────────

/**
 * 把一份档案封成信封。
 *
 * @param options.params 覆盖 KDF 参数。**只应由测试或未来的「提高安全性」迁移使用** ——
 *   生产路径一律走 `DEFAULT_KDF_PARAMS`。
 */
export async function sealArchive(
  archive: ArchiveV1,
  passphrase: string,
  options?: { readonly params?: KdfParams },
): Promise<EncryptedEnvelope> {
  const header = await createEnvelopeHeader(options?.params ?? DEFAULT_KDF_PARAMS)
  const dek = await randomBytes(KEY_BYTES)

  try {
    // serializeArchive 内部会先过一遍 schema 校验，因此不合法的档案
    // 不会有机会被写进密文 —— 那种错误必须在加密前就暴露。
    const plaintext = await utf8ToBytes(serializeArchive(archive))

    return {
      format: ENVELOPE_FORMAT,
      version: ENVELOPE_VERSION,
      kdf: header,
      cipher: { algorithm: AEAD_ALGORITHM },
      wrappedKey: await wrapDek(header, dek, passphrase),
      payload: await sealPayload(dek, plaintext),
    }
  } finally {
    // 尽力而为的内存清理。JS 的 GC 可能早已复制过这些字节，
    // 所以这不是一道安全保证，只是缩短密钥在堆上可被扫描到的窗口。
    dek.fill(0)
  }
}

/**
 * 解开信封。
 *
 * 失败路径全部归一为 `CryptoError`，调用方只需处理一种错误类型：
 *   - `malformed_envelope`    文件结构不对，或解出来的内容不是合法档案
 *   - `unsupported_version`   文件来自更晚的版本
 *   - `unsupported_algorithm` 用了本实现还没有的算法
 *   - `invalid_params`        信封里的 KDF 参数越界（防 DoS）
 *   - `decryption_failed`     口令错，或任何一处字节被改过
 */
export async function openArchive(envelope: unknown, passphrase: string): Promise<ArchiveV1> {
  const record = parseEnvelopeFile(envelope)
  const dek = await unwrapDek(record.kdf, record.wrappedKey, passphrase)

  try {
    const plaintext = await openPayload(dek, record.payload)

    let text: string
    try {
      text = await bytesToUtf8(plaintext)
    } catch {
      throw new CryptoError('malformed_envelope', '解密结果不是合法 UTF-8 文本')
    }

    try {
      return deserializeArchive(text)
    } catch (cause) {
      // 解密成功却解不出一份合法档案，说明文件本身是坏的。
      // 归一成 CryptoError 是为了让调用方只需要处理一种错误类型 ——
      // 对用户而言「口令错」和「文件损坏」的提示与处理方式是一样的。
      throw new CryptoError('malformed_envelope', `解密出的内容不是合法档案：${String(cause)}`)
    }
  } finally {
    dek.fill(0)
  }
}
