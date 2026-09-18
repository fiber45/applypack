/**
 * AEAD：认证加密（Authenticated Encryption with Associated Data）。
 *
 * ```
 * DEK ──XChaCha20-Poly1305(nonce, aad)──► 密文 ‖ 16 字节认证标签
 * ```
 *
 * 这里有两件事和「加密」同等重要：
 *
 * **① 认证标签必须被检查，且失败时必须抛错。**
 * AEAD 与「对称加密 + 一个 hash」的区别就在于：密文、nonce 与 AAD 三者中
 * 任何一个被改动，解密都会失败。密码学代码最危险的失败模式不是「抛错」，
 * 而是**悄悄返回半份数据** —— 所以本模块的所有失败路径都是显式的 `CryptoError`。
 *
 * **② AAD 是「把这团密文绑到某个上下文」的手段。**
 * 信封用它把「KDF 参数 + 盐」钉在密文上：改了头部就解不开。
 * 这让头部字段从「可自由编辑的元数据」变成「被密码学保护的数据」。
 *
 * 注意 `decryption_failed` 是故意粗粒度的：口令错与密文被篡改在数学上不可区分
 * （认证标签对两者一视同仁）。硬要分开只能泄漏额外信息，那正是攻击者想要的。
 */
// 必须 default 导入 —— 原因见 `bytes.ts` 顶部注释。
import sodium from 'libsodium-wrappers'

import { initCrypto, randomBytes } from './bytes'
import { CryptoError } from './errors'
import { AEAD_NONCE_BYTES, AEAD_TAG_BYTES, KEY_BYTES } from './params'

export interface SealedBox {
  readonly nonce: Uint8Array
  /** 密文与认证标签拼接后的输出（长度 = 明文长度 + 16）。 */
  readonly ciphertext: Uint8Array
}

function assertKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
    throw new CryptoError(
      'invalid_params',
      `密钥必须是 ${KEY_BYTES} 字节的 Uint8Array，收到 ${key?.length ?? '非 Uint8Array'}`,
    )
  }
}

/**
 * 加密。
 *
 * **每次调用都生成新的随机 nonce，绝不接受调用方传入。**
 * 这是刻意的 API 设计：nonce 复用对 XChaCha20-Poly1305 同样是致命的
 * （会泄漏两段明文的异或），而「让调用方记得传 nonce」等于把这类事故
 * 留给了最容易出错的那一层。192-bit 随机 nonce 的空间下，
 * 生成 2^80 条记录才有可忽略的碰撞概率 —— 远远超出个人档案的量级。
 */
export async function aeadSeal(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Promise<SealedBox> {
  await initCrypto()
  assertKey(key)

  const nonce = await randomBytes(AEAD_NONCE_BYTES)

  try {
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      aad ?? new Uint8Array(0),
      null, // secret_nonce：libsodium 保留参数，必须为 null
      nonce,
      key,
    )
    return { nonce, ciphertext }
  } catch (cause) {
    // 加密失败只可能是用法错误（长度越界等），不是安全事件。
    throw new CryptoError('invalid_params', `加密失败：${String(cause)}`)
  }
}

/**
 * 解密并验证。
 *
 * 失败一律抛 `decryption_failed` —— 无论原因是口令错、密文被改、
 * AAD 不匹配还是 `nonce` 长度不对（长度不对是 `invalid_params`，
 * 因为它属于调用方的用法错误，不是攻击信号）。
 */
export async function aeadOpen(key: Uint8Array, box: SealedBox, aad?: Uint8Array): Promise<Uint8Array> {
  await initCrypto()
  assertKey(key)

  if (!(box.nonce instanceof Uint8Array) || box.nonce.length !== AEAD_NONCE_BYTES) {
    throw new CryptoError(
      'invalid_params',
      `nonce 必须是 ${AEAD_NONCE_BYTES} 字节的 Uint8Array，收到 ${box.nonce?.length ?? '非 Uint8Array'}`,
    )
  }

  if (!(box.ciphertext instanceof Uint8Array) || box.ciphertext.length < AEAD_TAG_BYTES) {
    // 连一个完整的认证标签都装不下，不可能是有效的密文。
    throw new CryptoError('decryption_failed', '密文长度不足，缺少完整的认证标签')
  }

  let opened: Uint8Array | null
  try {
    opened = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, // secret_nonce
      box.ciphertext,
      aad ?? new Uint8Array(0),
      box.nonce,
      key,
    )
  } catch {
    // libsodium 在认证失败时可能抛错也可能返回 null，两种都归一到同一种结果。
    throw new CryptoError('decryption_failed', '认证失败：口令错误，或数据已被篡改')
  }

  if (opened === null || opened === undefined) {
    throw new CryptoError('decryption_failed', '认证失败：口令错误，或数据已被篡改')
  }

  return opened
}

/**
 * 生成一把随机的数据加密密钥（DEK）。
 *
 * 放在这里而不是单独的 `keys.ts`：它与 AEAD 是绑定的 ——
 * 长度必须是 32 字节，因为 `aeadSeal` 只接受这个长度。
 * 拆成两个文件只会让「DEK 长度由谁定义」这件事变得模糊。
 */
export async function generateDek(): Promise<Uint8Array> {
  return randomBytes(KEY_BYTES)
}
