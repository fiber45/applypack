/**
 * 三道缰绳 —— DESIGN 9「硬性终止」的逐条验证。
 *
 * 三条各有一组，且**必须各测一条**：合成一条「总之会停」的断言，
 * 会在只剩下最多余的那条绳子还有效时依然通过。
 * 三条绳子的意义完全不同 ——
 *
 *   - 轮数用满：说明「应该会收敛」的判断错了
 *   - 预算用满：说明它在收敛，但太贵
 *   - 超时：说明卡住了，问题在环境或模型侧
 *
 * 报错理由写错，用户会被引向错误的处置方向（加钱 / 加轮数 / 查网络）。
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_NO_PROGRESS_LIMIT,
  checkRopes,
  estimateTokens,
  usageOf,
} from './budget'
import { candidates, FABRICATED, ITEMS, JD, mockClient, NOW, output } from './__fixtures__/agent-harness'
import { runAgent } from './loop'
import type { AgentInput, AgentOptions } from './types'

const input: AgentInput = {
  jd: JD,
  candidates: candidates().slice(0, 1),
  items: ITEMS,
  maxBullets: 1,
}

const failing = (): ReturnType<typeof mockClient> => mockClient(() => output(FABRICATED))

function options(client: AgentOptions['client'], overrides: Partial<AgentOptions> = {}): AgentOptions {
  return { client, model: 'm', now: NOW, ...overrides }
}

describe('默认值就是 DESIGN 9 写的那两个', () => {
  it('轮数上限 6、无进展容忍 1 轮', () => {
    expect(DEFAULT_MAX_ROUNDS).toBe(6)
    expect(DEFAULT_NO_PROGRESS_LIMIT).toBe(1)
  })
})

describe('绳子一：轮数', () => {
  it('maxRounds 为 1 时只跑一轮，理由是「轮数用满」而不是「无进展」', async () => {
    const harness = failing()
    const outcome = await runAgent(input, options(harness.client, { maxRounds: 1 }))

    expect(outcome.rounds).toBe(1)
    expect(outcome.termination).toBe('rounds_exhausted')
  })

  it('maxRounds 给 0 或负数时收敛为 1 —— 一次都不跑的循环不是循环', async () => {
    const harness = failing()
    const outcome = await runAgent(input, options(harness.client, { maxRounds: 0 }))
    expect(outcome.rounds).toBe(1)
  })
})

describe('绳子二：token 预算', () => {
  it('预算不够跑第二轮时停下，理由是可加的预算而不是无解', async () => {
    const harness = failing()
    const outcome = await runAgent(input, options(harness.client, { tokenBudget: 1 }))

    expect(outcome.termination).toBe('budget_exhausted')
    expect(outcome.rounds).toBe(1)
    // 预算确实是「用掉了一些」才触发的，不是一开始就判超
    expect(outcome.spentTokens).toBeGreaterThan(1)
    expect(harness.seen.length).toBeGreaterThan(0)
  })

  it('预算充足时不受影响，走到正常的无进展终止', async () => {
    const harness = failing()
    const outcome = await runAgent(input, options(harness.client, { tokenBudget: 1_000_000 }))
    expect(outcome.termination).toBe('no_progress')
    expect(outcome.rounds).toBe(2)
  })

  it('用量计入的是「发出去的载荷 + 收回来的文本」，不是调用次数', async () => {
    const harness = mockClient(() => output(FABRICATED))
    const outcome = await runAgent(input, options(harness.client))
    expect(outcome.calls).toBe(6)
    // 六次调用里每次的载荷都有几千字符（系统提示 + JD + 原文），远多于 6
    expect(outcome.spentTokens).toBeGreaterThan(1000)
  })
})

describe('绳子三：超时', () => {
  it('假时钟推进后停下，且已经跑完的那一轮成果保留', async () => {
    // 调用次序：startedAt → 第 1 轮开头 → 第 2 轮开头
    const ticks = [0, 0, 10_000]
    let index = 0
    const clock = (): number => {
      const value = ticks[Math.min(index, ticks.length - 1)] ?? 0
      index += 1
      return value
    }

    const harness = failing()
    const outcome = await runAgent(input, options(harness.client, { timeoutMs: 5_000, clock }))

    expect(outcome.termination).toBe('timeout')
    expect(outcome.rounds).toBe(1)
  })

  it('超时不影响内容判定：两个都没超时的运行给出同一结果', async () => {
    const a = await runAgent(input, options(failing().client, { timeoutMs: 600_000 }))
    const b = await runAgent(input, options(failing().client, { timeoutMs: 600_000 }))
    expect(a.termination).toBe(b.termination)
    expect(a.rounds).toBe(b.rounds)
    expect(a.spentTokens).toBe(b.spentTokens)
  })
})

describe('checkRopes 是纯函数，边界与优先级都可枚举', () => {
  const limits = { maxRounds: 6, tokenBudget: 100, timeoutMs: 1000 }

  it('三条都未达到时返回 null', () => {
    expect(checkRopes({ roundsDone: 5, spentTokens: 99, elapsedMs: 999 }, limits)).toBeNull()
  })

  it('等于阈值即算达到 —— 用 >= 而不是 >，否则「刚好用满」会被放行', () => {
    expect(checkRopes({ roundsDone: 6, spentTokens: 0, elapsedMs: 0 }, limits)).toBe(
      'rounds_exhausted',
    )
    expect(checkRopes({ roundsDone: 0, spentTokens: 100, elapsedMs: 0 }, limits)).toBe(
      'budget_exhausted',
    )
    expect(checkRopes({ roundsDone: 0, spentTokens: 0, elapsedMs: 1000 }, limits)).toBe('timeout')
  })

  it('三条同时成立时报最容易被用户行动化解的那一条', () => {
    expect(checkRopes({ roundsDone: 9, spentTokens: 999, elapsedMs: 9999 }, limits)).toBe(
      'rounds_exhausted',
    )
  })

  it('null 表示不设限，而不是「上限为 0」', () => {
    const unlimited = { maxRounds: 2, tokenBudget: null, timeoutMs: null }
    expect(checkRopes({ roundsDone: 1, spentTokens: 10_000_000, elapsedMs: 86_400_000 }, unlimited)).toBeNull()
  })
})

describe('token 估算：是一根绳子，不是账本', () => {
  it('汉字按字、其余按四字符约当', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('推荐系统')).toBe(4)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  it('单调：更长的文本估得更多', () => {
    expect(estimateTokens('推荐系统召回链路')).toBeGreaterThan(estimateTokens('推荐系统'))
  })

  it('provider 报的真实用量优先于估算', () => {
    expect(usageOf({ inputTokens: 100, outputTokens: 50 }, '很长的载荷', '回复', () => 9999)).toBe(150)
  })

  it('provider 没报（或报 0）时退回估算，不让预算绳子失效', () => {
    expect(usageOf(undefined, 'abcd', 'efgh', (text) => text.length)).toBe(8)
    expect(usageOf({ inputTokens: 0, outputTokens: 0 }, 'abcd', 'efgh', (text) => text.length)).toBe(8)
  })
})
