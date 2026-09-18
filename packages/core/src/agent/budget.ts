/**
 * 三道缰绳 —— DESIGN 9 的「硬性终止」。
 *
 * | 绳子 | 默认 | 为什么必须有 |
 * |---|---|---|
 * | 轮数 | 6 | 唯一无条件的兜底。任何「应该会收敛」的判断都不能只靠观察 |
 * | token 预算 | 不限 | 收敛但很贵的循环一样要能停。用户买的是结果，不是过程 |
 * | 超时 | 不限 | 模型侧卡住时，钱和时间都在流失 |
 *
 * ## 超时是「轮与轮之间」的检查，这是一处必须写明的局限
 *
 * core 没法中断一个已经飞出去的请求 —— 那需要一个 `AbortSignal`，而它是
 * 宿主环境（`fetch`）的东西，属于 Web 端的 `LLMClient` 实现。
 * 所以本层的超时语义是：**发现已经超时就再也不发起新的一批请求**。
 * 一批请求本身的耗时上限由那个实现负责（它拿得到 signal）。
 * 把它写成「超时了还在跑上一批」而不说明，是最容易被误解的那种缺口。
 *
 * ## 为什么这三条都不读系统时间也能用
 *
 * 只有超时用时间，而它的输入是 `elapsedMs`（由调用方算出来传进来）。
 * 于是本文件是纯函数：同一组输入永远同一输出。
 * 时间只在 `loop.ts` 里读一次（`clock()`），而那一次只喂给这条绳子。
 */

import type { TerminationReason } from './types'

export const DEFAULT_MAX_ROUNDS = 6

/**
 * 连续多少轮「失败签名」不变就判不会再有进展。
 *
 * 取 1 意味着：**两次同样的失败就停**。理由是本项目的失败反馈是结构化的
 * （`[number_not_in_source] 违规内容「40」`），一次改正不过来通常意味着
 * 模型做不到或素材里确实没有，而不是「再多试几次就好」。
 *
 * 代价是明确的：真实模型有随机性，有时第二轮会成功。想要更多机会就把它调大，
 * 换取的是钱与时间 —— 这个取舍交给调用方，而不是由本层替他决定。
 */
export const DEFAULT_NO_PROGRESS_LIMIT = 1

export interface RopeLimits {
  readonly maxRounds: number
  /** null 表示不设限 */
  readonly tokenBudget: number | null
  /** 毫秒。null 表示不设限 */
  readonly timeoutMs: number | null
}

export interface RopeState {
  /** 已完成的轮数 */
  readonly roundsDone: number
  readonly spentTokens: number
  readonly elapsedMs: number
}

/**
 * 检查三道绳子。返回 null 表示可以继续。
 *
 * 三条同时成立时，报**最容易被用户行动化解**的那一条：轮数与预算都是
 * 一行配置的事，而超时通常意味着环境问题（网络慢、模型侧排队），
 * 报成「轮数用满」会把人引向错误的处置方向。
 */
export function checkRopes(state: RopeState, limits: RopeLimits): TerminationReason | null {
  if (state.roundsDone >= limits.maxRounds) return 'rounds_exhausted'
  if (limits.tokenBudget !== null && state.spentTokens >= limits.tokenBudget) {
    return 'budget_exhausted'
  }
  if (limits.timeoutMs !== null && state.elapsedMs >= limits.timeoutMs) return 'timeout'
  return null
}

/**
 * token 估算。
 *
 * 汉字按 1 字符 ≈ 1 token，其余按 4 字符 ≈ 1 token —— 这是对主流分词器的
 * 粗略拟合，不是计量。**它是一根绳子，不是账本**：预算的用途是「别无限烧下去」，
 * 为此需要的精度是量级，而不是个位数。
 *
 * 有 provider 报的真实用量时优先用真实值（见 `usageOf`）。
 */
export function estimateTokens(text: string): number {
  if (text === '') return 0
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) ?? []).length
  const rest = text.length - cjk
  return cjk + Math.ceil(rest / 4)
}

/** provider 报的用量（若客户端提供了）优先于估算。 */
export function usageOf(
  usage: { readonly inputTokens?: number; readonly outputTokens?: number } | undefined,
  requestText: string,
  responseText: string,
  estimator: (text: string) => number,
): number {
  if (usage !== undefined) {
    const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    if (total > 0) return total
  }
  return estimator(requestText) + estimator(responseText)
}
