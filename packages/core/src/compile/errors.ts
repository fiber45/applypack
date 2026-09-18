import type { ParseFailure } from './parse'

/**
 * 编译在重试上限内仍未拿到合法结构时抛出。
 *
 * 这个错误的存在本身就是「坏 JSON 率 = 0」的实现方式：编译层**要么返回通过
 * schema 校验的对象，要么抛错**，不存在「返回一个残缺对象让调用方自己小心」的第三种形态。
 * 后者才是「坏 JSON 率」真正会伤害到人的地方 —— 它把问题从一次明确的失败
 * 变成了下游某个字段莫名其妙为 undefined。
 */
export class CompileError extends Error {
  readonly code = 'compile_failed'
  readonly attempts: number
  readonly failure: ParseFailure

  constructor(failure: ParseFailure, attempts: number) {
    super(`编译失败：${attempts} 次尝试后仍未得到合法结构（${failure.code}）—— ${failure.detail}`)
    this.name = 'CompileError'
    this.attempts = attempts
    this.failure = failure
  }
}
