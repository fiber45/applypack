/**
 * 出网组装 + 发送 —— 「三层防空」的收口。
 *
 * 本模块存在的唯一理由是：**让「绕过检查」这件事在 API 表面上不存在。**
 *
 * 如果 core 只导出 `projectArchiveForLLM`，调用方依然可以自己拼一个
 * `{ messages: [原始档案] }` 直接发给 provider —— 投影函数正确与否就变得无关紧要了。
 * 所以出网路径被收敛成两个函数：
 *
 *   assembleLLMRequest(档案, ...)  →  LLMRequest   （构造 + 断言）
 *   callLLM(client, 档案, ...)     →  LLMResponse  （构造 + 断言 + 发送）
 *
 * 调用方永远拿不到「未经断言就发出去」的机会。这一点由
 * `egress/index.ts` 的导出面断言与 `request.test.ts` 的绕过尝试共同守着。
 *
 * @see DESIGN.md 8.1 · AGENTS.md §6
 */

import type { ArchiveV1 } from '../schema/index'
import { EgressLeakError } from './errors'
import { projectArchiveForLLM } from './project'
import { blockingLeaks, scanPayload, type Leak } from './scan'
import type { LLMClient, LLMMessage, LLMRequest, LLMResponse } from './types'

export interface AssembleOptions {
  /**
   * 用户档案。**可选** —— JD 编译这类任务的上下文里根本不该有用户数据，
   * 传一份空档案进去反而会在载荷里留下一个空的 `{}` 让人误以为「档案已就位」。
   * 省略即表示「本次请求与用户档案无关」。
   */
  readonly archive?: ArchiveV1
  readonly model: string
  /** 系统提示：角色 + 硬约束 + 输出 schema。永不变。 */
  readonly system: string
  /** 参考资料：术语表与 few-shot 范例。极少变，仍属缓存前缀。 */
  readonly reference?: string
  /** 易变部分：结构化 JD 与本轮任务。**按设计排在缓存断点之后。** */
  readonly volatile: readonly LLMMessage[]
}

/**
 * 构造一次出网请求。返回值已通过 B 级扫描，且被冻结。
 *
 * 冻结是刻意的：请求对象在交给 client 之前若还能被改写，那么「断言通过」
 * 就只对断言那一刻成立。`Object.freeze` 把这一点变成了运行时事实 ——
 * 后续任何一次 `request.cachedPrefix.push(...)` 都会抛错，而不是悄悄多送一份数据出去。
 */
export function assembleLLMRequest(options: AssembleOptions): LLMRequest {
  const cachedPrefix: LLMMessage[] = [
    { role: 'user', content: options.system },
  ]
  if (options.reference !== undefined && options.reference !== '') {
    cachedPrefix.push({ role: 'user', content: options.reference })
  }
  if (options.archive !== undefined) {
    // 档案在缓存前缀的**末尾**：它是会话内最不稳定的稳定内容，
    // 把断点打在它之后，JD 与任务指令的变动才不会波及系统提示与范例。
    cachedPrefix.push({
      role: 'user',
      content: JSON.stringify(projectArchiveForLLM(options.archive)),
    })
  }

  const request: LLMRequest = {
    model: options.model,
    cachedPrefix,
    volatile: options.volatile,
  }

  // 没有档案时也过一遍断言：它此时扫不出东西，但**每次都调用**这件事本身
  // 才是契约 —— 出网路径上不留「因为这次没有数据所以跳过检查」的分支。
  assertNoBLevelEgress(request, options.archive)

  return Object.freeze({
    model: request.model,
    cachedPrefix: Object.freeze([...cachedPrefix]),
    volatile: Object.freeze([...options.volatile]),
  })
}

/**
 * 出口断言。任何准备离开设备的对象都应先过这里。
 *
 * 返回全部命中（含 `advisory`）以便调用方记录；**阻断判定只看 `blocking`**，
 * 因为 `advisory` 覆盖的是姓名这类短标识符 —— 它们在自由文本里无法与
 * 「正常提及」区分，把它们升级成阻断会让整个机制在第一次遇到中文姓名时被关掉。
 * 短标识符的防线是路径扫描 + 投影，不是值扫描。见 scan.ts 的说明。
 */
export function inspectEgress(payload: unknown, source: unknown): readonly Leak[] {
  return scanPayload(payload, source)
}

/** 出口断言：命中阻断级别的泄漏直接抛错。 */
export function assertNoBLevelEgress(payload: unknown, source: unknown): void {
  const blocking = blockingLeaks(inspectEgress(payload, source))
  if (blocking.length > 0) throw new EgressLeakError(blocking)
}

/**
 * 唯一的出网调用。组装 → 断言 → 发送，一气呵成。
 *
 * 之所以把「发送」也收进 core（而不是让 Web 端自己拿着 request 去调 SDK）：
 * 断言与发送之间只要隔着一层调用方代码，就存在「先断言、后被改」的窗口。
 * 收进一个函数，窗口就没了。
 */
export async function callLLM(client: LLMClient, options: AssembleOptions): Promise<LLMResponse> {
  const request = assembleLLMRequest(options)
  return client.complete(request)
}
