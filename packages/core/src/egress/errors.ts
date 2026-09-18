import type { Leak } from './scan'

/**
 * B 级数据试图出网时抛出的错误。
 *
 * 这个错误是**整个隐私叙事的技术支点**：把它抛在这里，就意味着
 * 「数据没出去」不是一句承诺，而是一次被中断的函数调用。
 *
 * 关于 `message`：它只包含字段路径与脱敏摘要，**不含完整值**。
 * 一条把手机号完整打印出来的错误消息，会让错误日志（通常比请求体更容易被
 * 收集、上报、粘贴进 issue）变成新的泄漏通道。
 */
export class EgressLeakError extends Error {
  readonly code = 'b_level_egress_blocked'
  readonly leaks: readonly Leak[]

  constructor(leaks: readonly Leak[]) {
    const detail = leaks
      .map((leak) => `${leak.source}（${leak.kind}，${leak.preview}）`)
      .join('、')
    super(`出网请求被阻断：检测到 ${leaks.length} 处 B 级数据 —— ${detail}`)
    this.name = 'EgressLeakError'
    this.leaks = Object.freeze([...leaks])
  }
}
