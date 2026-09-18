/**
 * `.vault` 备份文件的读写。
 *
 * 备份的全部价值在于**它是原件**，不是摘要。因此这里只有两条要求，
 * 而两条都必须可断言：
 *
 * **① 导出与导入逐字节对称。** 导出的文本重新解析后必须与原对象深相等，
 * 且能解出全字段相等的档案。这一条排除了「导出时裁剪空字段」「导出时补默认值」
 * 这类看似贴心的行为 —— 它们让备份在**用户不知情时**偏离了原件，
 * 而且通常要等到某天真的要用它恢复时才会被发现。
 *
 * **② 写出去的东西必须能被自己读回来。** `serializeVaultFile` 在写出前
 * 会过一遍 `parseEnvelopeFile`。一次「导出成功、导入失败」的备份
 * 比一次导出失败危险得多：用户在导出成功的那一刻就认为自己安全了。
 */
import { CryptoError, parseEnvelopeFile, type EncryptedEnvelope } from '../crypto/index'

/** 备份文件扩展名。导出时用它，导入时也认它。 */
export const VAULT_FILE_EXTENSION = '.vault'

/**
 * 备份文件名白名单：ASCII 字母数字、点、下划线、连字符。
 *
 * 与 T4c 的 PDF 文件名同一条理由 —— 中文与空格的文件名在某些操作系统 / 网盘 /
 * 邮件附件链路里会被改写或截断。备份文件是**灾难恢复路径**上的东西，
 * 它不该有任何一次额外的失败机会。
 */
const VAULT_FILE_NAME_PATTERN = /^[A-Za-z0-9_.-]+\.vault$/

export function isVaultFileName(name: string): boolean {
  return VAULT_FILE_NAME_PATTERN.test(name)
}

/**
 * 序列化为可写盘的文本。
 *
 * 缩进用 2 空格：`.vault` 会被用户用文本编辑器打开（至少会看一眼），
 * 逐字段分行的结构让「这是个加密文件、里面有 format/version/kdf/cipher」这件事
 * 直接可读 —— 这对「隐私可自证」的叙事是加分项，代价只是几十个字节。
 */
export function serializeVaultFile(file: EncryptedEnvelope): string {
  // 先解析再序列化：保证「写出去的」满足「读进来的」前提。
  // 这一步也顺带拒绝了被调用方改坏的选项对象（例如手工拼出来的假信封）。
  return `${JSON.stringify(parseEnvelopeFile(file), null, 2)}\n`
}

/** 解析一段 `.vault` 文本。任何失败都归一为 `CryptoError`。 */
export function parseVaultFile(text: string): EncryptedEnvelope {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (cause) {
    throw new CryptoError('malformed_envelope', `备份文件不是合法 JSON：${String(cause)}`)
  }
  return parseEnvelopeFile(raw)
}
