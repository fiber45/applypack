/**
 * 加密层的错误类型。
 *
 * 为什么要把错误码做成枚举而不是让人 `catch (e)` 后读 message：
 * 加密层的失败路径**必须可被程序区分**。`invalid_params`（信封里的参数不合法）、
 * `decryption_failed`（口令错或密文被改）、`unsupported_version`（文件来自更晚的版本）
 * 对应三种完全不同的用户提示与处理方式，混成一个「解密失败」等于把可诊断的问题
 * 变成不可诊断。
 *
 * 特别注意 `decryption_failed` 是**故意粗粒度**的：
 * 口令错误与密文被篡改在 AEAD 的数学上不可区分（认证标签对两者一视同仁），
 * 硬要分开只能靠泄漏额外信息，那正是攻击者想要的。所以这里如实只给一个码。
 */

export type CryptoErrorCode =
  /** 参数不合法：口令为空、盐长度不对、密钥长度不对、KDF 参数越界等。 */
  | 'invalid_params'
  /** 认证失败：口令错误，或密文 / nonce / AAD / 头部元数据被改动。 */
  | 'decryption_failed'
  /** 信封结构不合法：不是对象、缺字段、字段类型不对。 */
  | 'malformed_envelope'
  /** 信封版本高于本实现支持的版本。 */
  | 'unsupported_version'
  /** 信封声明的算法本实现不支持（例如未来加入的其他 AEAD）。 */
  | 'unsupported_algorithm'
  /** 运行环境缺少必需的密码学能力（本实现依赖的 libsodium 未就绪）。 */
  | 'crypto_unavailable'

export class CryptoError extends Error {
  readonly code: CryptoErrorCode

  constructor(code: CryptoErrorCode, message: string) {
    super(message)
    this.name = 'CryptoError'
    this.code = code
  }
}
