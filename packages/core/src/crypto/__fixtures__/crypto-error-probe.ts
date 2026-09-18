/**
 * 断言辅助：把一个「本该失败」的 Promise 的失败原因取成可比较的字符串。
 *
 * 密码学代码的测试重点在失败路径上，而失败路径的断言写法很容易退化成
 * 「只要抛错就算过」—— 那样连「因为参数校验失败」和「因为认证失败」都不区分，
 * 也就测不出真正的问题。这里统一把 `CryptoError.code` 取出来比较。
 */
import { CryptoError } from '../errors'

export async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof CryptoError) return error.code
    return `非 CryptoError: ${String(error)}`
  }
  return '（没有抛错）'
}
