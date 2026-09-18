/**
 * 循环行为。
 *
 * TASKS.md T3.3 的四条勾里，三条在这里（白名单在 `tools.test.ts`）：
 *
 *   - 「轮数 + 预算 + 超时三重硬终止」   → `ropes.test.ts` 各测一条绳子
 *   - 「验收器非 LLM（架构上无法绕过）」 → 本文件里那条「模型说好不算好」
 *   - 「永远失败的改写：N 轮内终止且不死循环」 → 本文件里那条 `no_progress`
 *
 * 最后一条是本任务最该被认真写的一条。**它要证明的不是「有个上限」**，
 * 而是「本层能看出无解」。上限只是兜底：靠上限终止意味着钱已经花完了。
 */

import { describe, expect, it } from 'vitest'

import { blockingLeaks, scanPayload } from '../egress/index'
import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import {
  candidates,
  FABRICATED,
  goodWith,
  ITEMS,
  JD,
  mockClient,
  NOW,
  OPENINGS,
  output,
  SOURCE_TEXT,
} from './__fixtures__/agent-harness'
import { runAgent } from './loop'
import { TOOL_NAMES } from './tools'
import type { AgentInput, AgentOptions } from './types'

function input(overrides: Partial<AgentInput> = {}): AgentInput {
  return { jd: JD, candidates: candidates(), maxBullets: 2, items: ITEMS, ...overrides }
}

function options(client: AgentOptions['client'], overrides: Partial<AgentOptions> = {}): AgentOptions {
  return { client, model: 'm', now: NOW, ...overrides }
}

/** 每条用不同的强动词开头，避开「同一动词最多 2 次」的硬约束。 */
function passThrough(): ReturnType<typeof mockClient> {
  return mockClient((bulletId) => {
    const index = Number(bulletId.replace('b', '')) % OPENINGS.length
    return output(goodWith(OPENINGS[index] ?? '重构'))
  })
}

describe('一轮就通过的路径', () => {
  it('两条都合规：status = passed，只跑一轮', async () => {
    const harness = passThrough()
    const outcome = await runAgent(input(), options(harness.client))

    expect(outcome.status).toBe('passed')
    expect(outcome.termination).toBe('passed')
    expect(outcome.rounds).toBe(1)
    expect(outcome.calls).toBe(2)
    expect(outcome.failures).toEqual([])
    expect(outcome.unfixable).toEqual([])
    expect(outcome.bullets.map((bullet) => bullet.bulletId)).toEqual(['b0', 'b1'])
  })

  it('目标层指标不达标**不影响**通过 —— 闸门管的是「有没有撒谎」', async () => {
    const harness = passThrough()
    const outcome = await runAgent(input(), options(harness.client))

    // JD 要 Python / 推荐系统 / PyTorch，稿子里只有「推荐系统」→ 覆盖率 1/3
    // （闸门把比率四舍五入到两位小数，所以这里是 0.33 而不是 0.3333…）
    expect(outcome.metrics.keywordCoverage).toBe(0.33)
    expect(outcome.status).toBe('passed')
  })

  it('通过不等于完整：JD 要的、素材里根本没有的技能仍然会变成追问', async () => {
    const harness = passThrough()
    const outcome = await runAgent(input(), options(harness.client))

    const asked = outcome.questions.map((question) => question.prompt).join('\n')
    expect(asked).toContain('Python')
    expect(asked).toContain('PyTorch')
    expect(outcome.questions.every((question) => question.kind === 'missing_fact')).toBe(true)
  })

  it('落选的条目带得出理由，不是只有一个「未采纳」', async () => {
    const harness = passThrough()
    const outcome = await runAgent(input(), options(harness.client))

    expect(outcome.rejected).toHaveLength(1)
    const rejected = outcome.rejected[0]
    expect(rejected?.entryId).toBe('work.2')
    expect(rejected?.summary.length).toBeGreaterThan(0)
    expect(Array.isArray(rejected?.detail)).toBe(true)
  })

  it('没有匹配信息时也给得出「为什么没进这一版」', async () => {
    const harness = passThrough()
    // 刻意不写 `items` 这个键：调用方手里可能真的没有 MatchItem
    const withoutItems: AgentInput = { jd: JD, candidates: candidates(), maxBullets: 2 }
    const outcome = await runAgent(withoutItems, options(harness.client))

    // 按给定顺序取前 2 条，第 3 条落选
    expect(outcome.bullets.map((bullet) => bullet.bulletId)).toEqual(['b0', 'b1'])
    expect(outcome.rejected[0]?.summary).toContain('2 条')
  })
})

describe('审计：每一步都经过白名单，且留痕', () => {
  it('日志里的工具名全部来自白名单，且四类工具都真的被用过', async () => {
    const harness = passThrough()
    const outcome = await runAgent(input(), options(harness.client))

    const used = [...new Set(outcome.log.map((step) => step.tool))]
    for (const tool of used) {
      expect(TOOL_NAMES).toContain(tool)
    }
    expect(used).toContain('score_match')
    expect(used).toContain('rewrite')
    expect(used).toContain('verify_facts')
    expect(used).toContain('keyword_gap')
    expect(used).toContain('ask_user')
  })

  it('日志按轮次递增，且第一轮的前置步骤标 0 轮', async () => {
    const harness = passThrough()
    const outcome = await runAgent(input(), options(harness.client))

    const rounds = outcome.log.map((step) => step.round)
    expect(rounds[0]).toBe(0)
    expect(rounds.slice(1)).toEqual([...rounds.slice(1)].sort((a, b) => a - b))
  })
})

describe('验收器不是模型：模型说好，不算好', () => {
  it('一份措辞漂亮但编了数字的稿子，永远不会被判定为通过', async () => {
    // 格式完美、语气专业、结构完整 —— 唯一的毛病是 40 这个数字原文里没有。
    // 除了确定性闸门，没有任何东西能看出这一点。
    const harness = mockClient(() => output(FABRICATED))
    const outcome = await runAgent(input({ maxBullets: 1 }), options(harness.client))

    expect(outcome.status).toBe('unfinished')
    expect(outcome.termination).not.toBe('passed')
    expect(outcome.unfixable).toHaveLength(1)
    expect(outcome.unfixable[0]?.failure.detail).toContain('number_not_in_source')
    expect(outcome.unfixable[0]?.failure.detail).toContain('40')
    // 产不出合规稿子，就不该有稿子出现在结果里
    expect(outcome.bullets).toEqual([])
  })
})

describe('不死循环：看出无解就停，而不是把轮数用满', () => {
  it('永远失败的改写：两轮内终止，理由是可读的', async () => {
    const harness = mockClient(() => output(FABRICATED))
    const outcome = await runAgent(input({ maxBullets: 1 }), options(harness.client, { maxRounds: 6 }))

    // 上限是 6 轮，但没有用满 —— 第二轮失败签名与第一轮完全一致，再跑也不会变
    expect(outcome.rounds).toBe(2)
    expect(outcome.rounds).toBeLessThan(6)
    expect(outcome.termination).toBe('no_progress')
    // 一轮 1 条 × 3 次重试
    expect(outcome.calls).toBe(6)
  })

  it('换一个数字再编一次，不算「有进展」', async () => {
    // 签名只看「哪一条、违反了哪条规则」，不看具体违规内容：
    // 40 换成 50 依然是 number_not_in_source，规则没被修好。
    let counter = 0
    const harness = mockClient(() => {
      counter += 1
      return output(`重构推荐系统召回链路，将回填耗时降低 ${40 + counter}%`)
    })
    const outcome = await runAgent(input({ maxBullets: 1 }), options(harness.client, { maxRounds: 6 }))

    expect(outcome.termination).toBe('no_progress')
    expect(outcome.rounds).toBe(2)
  })

  it('noProgressLimit 调大就多给几轮 —— 这个取舍交给调用方', async () => {
    const harness = mockClient(() => output(FABRICATED))
    const outcome = await runAgent(
      input({ maxBullets: 1 }),
      options(harness.client, { maxRounds: 5, noProgressLimit: 3 }),
    )

    expect(outcome.rounds).toBe(4)
    expect(outcome.termination).toBe('no_progress')
  })

  it('一条失败不牵连另一条：失败的那条留在报错里，另一条照样定稿', async () => {
    const harness = mockClient((bulletId) =>
      bulletId === 'b0' ? output(FABRICATED) : output(goodWith('主导')),
    )
    const outcome = await runAgent(input(), options(harness.client))

    expect(outcome.bullets.map((bullet) => bullet.bulletId)).toEqual(['b1'])
    expect(outcome.status).toBe('unfinished')
    // 追问里点名了哪一条、卡在哪里
    const asked = outcome.questions.map((question) => question.prompt).join('\n')
    expect(asked).toContain('b0')
    expect(asked).toContain('40')
  })
})

describe('零产出的边界', () => {
  it('目标条数为 0：显式认输，而不是报「通过」', async () => {
    const harness = passThrough()
    const outcome = await runAgent(input({ maxBullets: 0 }), options(harness.client))

    expect(outcome.status).toBe('unfinished')
    expect(outcome.termination).toBe('needs_user')
    expect(outcome.rounds).toBe(0)
    expect(harness.seen).toHaveLength(0)
    expect(outcome.questions).toHaveLength(1)
  })

  it('一条候选都没有：追问文案说的是「还没有任何经历」', async () => {
    const harness = passThrough()
    const outcome = await runAgent(input({ candidates: [], maxBullets: 2 }), options(harness.client))

    expect(outcome.termination).toBe('needs_user')
    expect(outcome.bullets).toEqual([])
    expect(outcome.questions[0]?.prompt).toContain('还没有任何经历')
  })
})

describe('端到端：B 级数据一次都不出网', () => {
  it('满档案 + 整个循环跑完，全部捕获请求零阻断命中', async () => {
    const harness = passThrough()
    await runAgent(
      input(),
      options(harness.client, { archive: maximalArchiveV1, reference: '范例' }),
    )

    expect(harness.seen.length).toBeGreaterThan(0)
    for (const request of harness.seen) {
      expect(blockingLeaks(scanPayload(request, maximalArchiveV1))).toEqual([])
    }
  })

  it('反向验证：那份档案里确实有 B 级值，且 A 级内容确实进了载荷', async () => {
    const harness = passThrough()
    await runAgent(
      input(),
      options(harness.client, { archive: maximalArchiveV1, reference: '范例' }),
    )

    const payload = harness.seen
      .map((request) => request.cachedPrefix.map((message) => message.content).join('\n'))
      .join('\n')
    expect(JSON.stringify(maximalArchiveV1)).toContain('+8613800138000')
    expect(payload).not.toContain('+8613800138000')
    expect(payload).toContain('推荐系统')
  })

  it('素材原文逐字进载荷 —— 溯源链的参照物没有被摘要替换', async () => {
    const harness = passThrough()
    await runAgent(input(), options(harness.client))

    const first = harness.seen[0]
    expect(first).toBeDefined()
    const task = first?.volatile.find((message) => message.content.includes('<candidate id='))
    expect(task?.content).toContain(SOURCE_TEXT)
  })
})
