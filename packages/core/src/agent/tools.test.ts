/**
 * 白名单与工具纯度。
 *
 * TASKS.md T3.3 的第一个勾是「工具白名单」—— 这里把它拆成三种可失败的断言：
 *
 *   1. 表的内容（五个名字、恰好一个出网点）
 *   2. 表的**执行力**（未知名字必须抛错，而不是返回空结果）
 *   3. 审计力（循环里跑过的工具名必须是表的子集）
 *
 * 第 2 条最容易被写成注释（「我们只允许这五个」），而注释拦不住一行 import。
 */

import { describe, expect, it } from 'vitest'

import { matchItems } from '../match/index'
import { verifyBullets } from '../verify/index'
import { ITEMS, JD, NOW, SOURCE_TEXT } from './__fixtures__/agent-harness'
import { UnknownToolError } from './errors'
import * as agentModule from './index'
import { TOOL_NAMES, TOOL_SPECS, dispatchTool, isWhitelisted } from './tools'
import type { ToolName } from './types'

describe('白名单的四条硬约束', () => {
  it('工具集合与 DESIGN 9 的表一致，一个不多一个不少', () => {
    expect(TOOL_NAMES).toEqual(['score_match', 'keyword_gap', 'rewrite', 'verify_facts', 'ask_user'])
  })

  it('恰好有一个工具会出网，且必须是 rewrite', () => {
    const networked = TOOL_SPECS.filter((spec) => spec.networked).map((spec) => spec.name)
    expect(networked).toEqual(['rewrite'])
  })

  it('每个工具都写了用途 —— 空描述的条目等于没进白名单', () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.purpose.length).toBeGreaterThan(8)
    }
  })

  it('未知名字抛错，而不是返回空结果', () => {
    const call = (): unknown => dispatchTool('send_raw' as ToolName, {} as never)
    expect(call).toThrow(UnknownToolError)
    expect(isWhitelisted('send_raw')).toBe(false)
    expect(isWhitelisted('rewrite')).toBe(true)
  })
})

describe('verify_facts：验收器不可能是模型', () => {
  /**
   * 覆盖全部 hard 规则的输入。造它出来的目的不是「检查闸门算得对」
   * （那是 T3.2 的事），而是为了下面那条**结构性前提**——
   * 循环的「下一轮重做哪些」完全依赖「阻断级失败都指向具体条目」。
   */
  const BULLETS = [
    { id: 'b0', text: '重构推荐系统召回链路，将回填耗时降低 40%' }, // 数字不可溯源
    { id: 'b1', text: '参与推荐系统召回链路的特征工程重构与上线' }, // 弱开头
    { id: 'b2', text: '推荐系统召回链路被重构，上线 12 个特征' }, // 被动语态
    {
      id: 'b3',
      text: '重构推荐系统召回通道的特征工程与离线特征回填链路的端到端性能优化改造工作，并完成上下游数据链路的联调与灰度发布验证',
    },
    { id: 'b4', text: '重构推荐系统召回链路，上线 12 个特征' }, // 动词重复（重构 ×3）
  ]

  it('阻断级失败一律指向具体条目，绝不落在 <全局> 占位上', async () => {
    const { result } = await dispatchTool('verify_facts', {
      bullets: BULLETS,
      sources: [SOURCE_TEXT],
      jd: JD,
    })

    const blocking = result.failures.filter((failure) => failure.severity !== 'target')
    expect(blocking.length).toBeGreaterThanOrEqual(4)
    for (const failure of blocking) {
      expect(failure.bulletId).not.toBe('<全局>')
    }
    // 反向验证：全局占位符确实会出现 —— 只是它们全是 target 层。
    // 没有这一条，上面的断言在「闸门根本没产出全局失败」时也会通过。
    const global = result.failures.filter((failure) => failure.bulletId === '<全局>')
    expect(global.length).toBeGreaterThan(0)
    expect(global.every((failure) => failure.severity === 'target')).toBe(true)
  })

  it('核验是同步算出来的 —— 真出网必然异步', () => {
    const result = verifyBullets({ bullets: [{ id: 'b0', text: '重构推荐系统召回链路' }], sources: [] })
    expect((result as unknown as { then?: unknown }).then).toBeUndefined()
  })
})

describe('keyword_gap 与闸门读的是同一套算法', () => {
  it('两边算出的覆盖率一致，不会出现「工具说 80%、闸门说 50%」', async () => {
    const text = '重构推荐系统召回链路，上线 12 个特征'
    const gap = await dispatchTool('keyword_gap', { texts: [text], jd: JD })

    expect(gap.hit).toEqual(['推荐系统'])
    expect(gap.missed).toEqual(['Python', 'PyTorch'])
    expect(gap.coverage).toBeCloseTo(1 / 3, 6)

    const result = verifyBullets({ bullets: [{ id: 'b0', text }], sources: [text], jd: JD })
    const coverage = result.failures.find((failure) => failure.reason === 'low_keyword_coverage')
    expect(coverage?.detail).toContain('33%')
  })

  it('JD 没有技能词时覆盖率为 1 —— 「没有要求」不等于「完全不满足」', async () => {
    const gap = await dispatchTool('keyword_gap', {
      texts: ['随便一段'],
      jd: { ...JD, skills: [] },
    })
    expect(gap.coverage).toBe(1)
    expect(gap.missed).toEqual([])
  })
})

describe('score_match 是匹配引擎的转发，不是第二套打分', () => {
  it('排序、入选线、淘汰解释与直接调 matchItems 完全一致', async () => {
    const viaTool = await dispatchTool('score_match', { items: ITEMS, jd: JD, now: NOW, limit: 2 })
    const direct = matchItems(ITEMS, JD, { now: NOW, limit: 2 })

    expect(viaTool.ranked.map((entry) => entry.entryId)).toEqual(
      direct.scored.map((entry) => entry.item.entryId),
    )
    expect(viaTool.selectedIds).toEqual(direct.selected.map((entry) => entry.item.entryId))
    expect(viaTool.cutoff).toBe(direct.cutoff)
    expect(viaTool.explanations).toEqual(direct.explanations)
  })

  it('夹具的分数确实是拉开的：命中技能词且最近的那条排第一', async () => {
    const result = await dispatchTool('score_match', { items: ITEMS, jd: JD, now: NOW, limit: 2 })
    expect(result.selectedIds[0]).toBe('work.0')
    expect(result.ranked.map((entry) => entry.entryId)).toEqual(['work.0', 'work.1', 'work.2'])
    expect(result.explanations.map((explanation) => explanation.entryId)).toEqual(['work.2'])
  })
})

describe('ask_user 是纯登记，不触发任何调用', () => {
  it('原样返回问题对象', async () => {
    const question = { bulletId: 'b0', kind: 'unfixable_by_model' as const, prompt: '这一条素材太短。' }
    const { question: returned } = await dispatchTool('ask_user', question)
    expect(returned).toEqual(question)
  })
})

describe('导出面是固定的', () => {
  it('新增出网能力或新增工具必须先改这一行', () => {
    expect(Object.keys(agentModule).sort()).toEqual([
      'DEFAULT_MAX_ROUNDS',
      'DEFAULT_NO_PROGRESS_LIMIT',
      'GLOBAL_ID',
      'TOOL_NAMES',
      'TOOL_SPECS',
      'UnknownToolError',
      'checkRopes',
      'dispatchTool',
      'estimateTokens',
      'failureSignature',
      'isWhitelisted',
      'nextPending',
      'runAgent',
      'summarizeVerdict',
      'usageOf',
    ])
  })
})
