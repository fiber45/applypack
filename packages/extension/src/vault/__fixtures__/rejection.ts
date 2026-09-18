/**
 * 断言辅助：把「本该失败」的 Promise 的失败原因取成可比较的字符串。
 *
 * 与 `core/crypto/__fixtures__/crypto-error-probe.ts` 同一个形状，但多认一种错误 ——
 * 扩展会话层同时会抛两种类型，而它们的关系是**刻意的**（见 `errors.ts`）：
 *
 *   - `CryptoError`（core）：口令错、副本被改 —— 由 core 抛出，本层原样透传
 *   - `ExtensionVaultError`（本包）：生命周期与副本 —— 输出成 `码:原因`
 *
 * 锁定原因必须一起进断言，不能只断言「抛了 vault_locked」：
 * 「还没解锁」和「空闲超时」给用户的提示是两句不同的话，
 * 而这三条路径（never_unlocked / idle_timeout / max_lifetime）在只断言错误码时
 * 完全不可区分 —— 那样写等于把最容易写错的那部分排除在测试之外。
 */
import { CryptoError } from '../../../../core/src/crypto/index'

import { ExtensionVaultError } from '../errors'

export async function rejectionOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ExtensionVaultError) return `${error.code}:${error.lockReason ?? '-'}`
    if (error instanceof CryptoError) return error.code
    return `非受控错误: ${String(error)}`
  }
  return '（没有抛错）'
}
