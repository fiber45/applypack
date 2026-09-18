/**
 * 密钥派生：口令 → KEK（Key Encryption Key）。
 *
 * ```
 * 口令 ──Argon2id(每条档案独立随机盐)──► KEK
 * ```
 *
 * 为什么用 Argon2id 而不是 PBKDF2 / scrypt：
 * Argon2id 是 2015 年密码哈希竞赛（PHC）的优胜者，也是 RFC 9106 的标准算法。
 * 它的 id 变体同时抵抗两类攻击 —— 前一半轮次按数据无关方式寻址（抗侧信道），
 * 后一半按数据相关方式寻址（抗时间-内存权衡），而 PBKDF2 只能靠抬高迭代次数，
 * 对 GPU/ASIC 的抵抗远弱于「内存硬」的 Argon2。
 *
 * 参数取值依据见 `params.ts` 的 `DEFAULT_KDF_PARAMS` 注释。
 */
import { argon2id } from 'hash-wasm'

import { initCrypto, utf8ToBytes } from './bytes'
import { CryptoError } from './errors'
import { DEFAULT_KDF_PARAMS, KDF_SALT_BYTES, assertKdfParams, type KdfParams } from './params'

/**
 * 由口令与盐派生 32 字节 KEK。
 *
 * @param passphrase 用户口令。**先做 NFKC 归一化**再编码为 UTF-8。
 * @param salt 每条档案独立随机的盐，长度必须为 16 字节。
 * @param params KDF 参数，默认取生产档位（m=64 MiB / t=3 / p=1）。
 *
 * 关于 NFKC 归一化 —— 这是为一个具体的中文场景做的决定：
 * 用户用输入法很容易打出全角字符，同一个「看起来一样」的口令在不同设备/输入法下
 * 可能是不同的码点序列，结果就是「口令明明记对了却打不开」。归一化把这个陷阱消掉。
 * 代价是极小的熵损失（全角与半角被视为同一口令），对本场景可忽略。
 *
 * 关于盐 —— **同一个人在不同设备上导出/导入 `.vault` 时，盐随文件走**，
 * 因此派生结果稳定；但同一口令用于两条不同档案时盐不同，KEK 也就不同，
 * 一条档案的密钥泄漏不会波及另一条。
 */
export async function deriveKek(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  // 先校验参数，再碰密码学 —— 越界的参数（尤其是来自外部信封的）不该让底层库
  // 去做未定义的事。
  assertKdfParams(params)

  if (salt.length !== KDF_SALT_BYTES) {
    throw new CryptoError(
      'invalid_params',
      `盐长度必须是 ${KDF_SALT_BYTES} 字节，收到 ${salt.length} 字节`,
    )
  }

  const normalized = passphrase.normalize('NFKC')
  if (normalized.length === 0) {
    // 零后端架构下「空口令」等价于「没有加密」，而用户极容易误操作成这样。
    // 与其让它悄悄产出一个人人可解的文件，不如直接拒绝。
    throw new CryptoError('invalid_params', '口令不能为空')
  }

  await initCrypto()
  const password = await utf8ToBytes(normalized)

  try {
    // 返回的是新分配的 Uint8Array —— 调用方可以安全地持有或清零它。
    return await argon2id({
      password,
      salt,
      parallelism: params.parallelism,
      iterations: params.iterations,
      memorySize: params.memoryKiB,
      hashLength: params.keyLength,
      outputType: 'binary',
    })
  } catch (cause) {
    throw new CryptoError('invalid_params', `Argon2id 派生失败：${String(cause)}`)
  }
}
