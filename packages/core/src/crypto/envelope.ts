/**
 * 加密信封：一个自包含、可落盘、可导出的密文文件。
 *
 * ```
 * ┌─ 明文头部（被 AAD 认证保护，改一个字节就解不开） ──────────────┐
 * │ format / version / kdf{算法, 参数, 盐} / cipher{algorithm}    │
 * └──────────────────────────────────────────────────────────────┘
 * ├─ wrappedKey  用 KEK 加密的 DEK                                ┤
 * └─ payload     用 DEK 加密的档案 JSON                            ┘
 * ```
 *
 * 三条设计决定：
 *
 * **① 信封是自包含的。** KDF 参数与盐都在文件里，解密方不需要任何外部配置。
 * 代价是这些字段变成**外部可写**的 —— 于是它们必须被当不可信输入校验
 * （见 `params.ts` 的上限说明），并且用 AAD 钉在密文上，使篡改必然导致解密失败。
 *
 * **② 两层密钥而不是一层。** 口令派生出的 KEK 只用来封装随机 DEK，档案本身由 DEK 加密。
 * 这样换口令只需重新封装 DEK，不必重写全部记录 —— T1.3 的增量录入依赖这一点。
 *
 * **③ 每个用途用不同的 AAD。** DEK 封装与内容加密各有一条 AAD 串，
 * 因此不可能把「被封装的数据密钥」当成内容密文去解，反之亦然。
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

/**
 * 头部的规范化绑定串。
 *
 * 用途是充当 AAD 的一部分：把这些字段「焊」到密文上。
 * 必须是**确定性拼接**（而不是 `JSON.stringify` 一个对象），
 * 否则键顺序一变，同一条记录就解不开了。
 */
function buildHeaderBinding(kdf: EnvelopeKdf): string {
  return [
    ENVELOPE_FORMAT,
    `v${ENVELOPE_VERSION}`,
    kdf.algorithm,
    String(kdf.memoryKiB),
    String(kdf.iterations),
    String(kdf.parallelism),
    String(kdf.keyLength),
    kdf.salt,
  ].join('|')
}

/** 不同用途用不同的 AAD，避免「被封装的数据密钥」与「内容密文」之间发生互换。 */
async function purposeAad(binding: string, purpose: 'dek' | 'payload'): Promise<Uint8Array> {
  return utf8ToBytes(`${binding}|purpose=${purpose}`)
}

async function encodeBox(box: SealedBox): Promise<EnvelopeSealedBox> {
  return { nonce: await bytesToBase64(box.nonce), ciphertext: await bytesToBase64(box.ciphertext) }
}

async function decodeBox(box: EnvelopeSealedBox): Promise<SealedBox> {
  return { nonce: await base64ToBytes(box.nonce), ciphertext: await base64ToBytes(box.ciphertext) }
}

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
  const params = options?.params ?? DEFAULT_KDF_PARAMS
  assertKdfParams(params)

  const salt = await randomBytes(KDF_SALT_BYTES)
  const kdf: EnvelopeKdf = {
    algorithm: params.algorithm,
    memoryKiB: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    keyLength: params.keyLength,
    salt: await bytesToBase64(salt),
  }

  const kek = await deriveKek(passphrase, salt, params)
  const dek = await randomBytes(KEY_BYTES)
  const binding = buildHeaderBinding(kdf)

  try {
    // serializeArchive 内部会先过一遍 schema 校验，因此不合法的档案
    // 不会有机会被写进密文 —— 那种错误必须在加密前就暴露。
    const plaintext = await utf8ToBytes(serializeArchive(archive))

    const wrapped = await aeadSeal(kek, dek, await purposeAad(binding, 'dek'))
    const payload = await aeadSeal(dek, plaintext, await purposeAad(binding, 'payload'))

    return {
      format: ENVELOPE_FORMAT,
      version: ENVELOPE_VERSION,
      kdf,
      cipher: { algorithm: AEAD_ALGORITHM },
      wrappedKey: await encodeBox(wrapped),
      payload: await encodeBox(payload),
    }
  } finally {
    // 尽力而为的内存清理。JS 的 GC 可能早已复制过这些字节，
    // 所以这不是一道安全保证，只是缩短密钥在堆上可被扫描到的窗口。
    kek.fill(0)
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
  const parsed = envelopeSchema.safeParse(envelope)
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

  const params: KdfParams = {
    algorithm: record.kdf.algorithm,
    memoryKiB: record.kdf.memoryKiB,
    iterations: record.kdf.iterations,
    parallelism: record.kdf.parallelism,
    keyLength: record.kdf.keyLength,
  }
  // 参数来自文件，按不可信输入校验 —— 一个 memoryKiB: 4194304 的信封
  // 足以让浏览器在「导入」那一刻尝试分配 4 GiB。
  assertKdfParams(params)

  const salt = await base64ToBytes(record.kdf.salt)
  if (salt.length !== KDF_SALT_BYTES) {
    throw new CryptoError(
      'malformed_envelope',
      `信封里的盐长度必须是 ${KDF_SALT_BYTES} 字节，收到 ${salt.length} 字节`,
    )
  }

  const binding = buildHeaderBinding(record.kdf)
  const kek = await deriveKek(passphrase, salt, params)

  try {
    const dek = await aeadOpen(kek, await decodeBox(record.wrappedKey), await purposeAad(binding, 'dek'))
    try {
      const plaintext = await aeadOpen(
        dek,
        await decodeBox(record.payload),
        await purposeAad(binding, 'payload'),
      )

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
  } finally {
    kek.fill(0)
  }
}
