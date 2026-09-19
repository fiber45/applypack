import { describe, expect, it } from 'vitest'

import { fillTestArchive } from './__fixtures__/fill-archive'
import { GENERIC_FORM_HTML, MOCKBOARD_FORM_HTML } from './__fixtures__/form-html'
import { parseHtmlFixture } from './__fixtures__/parse'
import {
  MOCKBOARD_ADAPTER,
  registerPlatformAdapter,
  resetPlatformAdaptersForTests,
} from './adapters'
import { buildFillPlan, type FillPlanItem } from './plan'
import { buildPreview } from './preview'
import {
  buildSubmitSummary,
  createSubmitGate,
  releaseSubmit,
  verifySubmitRelease,
  type SubmitRelease,
} from './submit-review'

/**
 * 提交前审核摘要（TASKS T5.5，DESIGN 11.4「护栏，而非功能」）。
 *
 * 两条验收在这里的落点：
 * 1. 「摘要区分自动填的与启发式猜的」—— `buildSubmitSummary` 按
 *    `source` 分列：adapter 来源进 `autoFilled`（全部来自档案），
 *    heuristic 来源进 `heuristicGuessed`（请重点核对，UI 高亮）。
 *    两列互斥、并集恰好等于全部 fill —— 双向投影相等，一列混入
 *    另一列的条目、漏掉任何一条都红。
 * 2. 「只拦截一次，放行由用户点击」—— 创建门即拦截（每份计划内容
 *    一次）；`releaseSubmit` 是用户那一下点击在纯逻辑层的化身，
 *    一次性消费（第二次调用抛错）；放行凭据与摘要 digest 绑定，
 *    计划在拦截之后变过 → 旧凭据作废，重新拦截。
 *    「拦截后静默放行 = 欺骗」由结构保证：除了拿着真门调
 *    `releaseSubmit`，本模块不存在任何产出合法凭据的路径。
 */

/** 把计划条目序列化成可比对的串 —— 投影相等断言的公共口径。 */
function serialize(items: readonly FillPlanItem[]): string[] {
  return items.map((item) => {
    if (item.kind === 'fill') return `fill:${item.key}:${item.path}:${item.value}:${item.source}`
    if (item.kind === 'gap') return `gap:${item.key}:${item.reason}:${String(item.blocking)}`
    return `file:${item.key}`
  })
}

describe('buildSubmitSummary —— 自动填的与猜的分列', () => {
  const plan = buildFillPlan(parseHtmlFixture(GENERIC_FORM_HTML), fillTestArchive())
  const preview = buildPreview(plan)
  const summary = buildSubmitSummary(preview)

  it('generic 表单无适配器：13 个 fill 全部落进「启发式猜的」，自动列为空', () => {
    expect(summary.autoFilled).toEqual([])
    expect(summary.heuristicGuessed.length).toBe(13)
    expect(summary.heuristicGuessed.every((f) => f.source === 'heuristic')).toBe(true)
  })

  it('两列互斥且并集恰好等于全部 fill —— 双向投影，混列或漏列都红', () => {
    const allFills = preview.plan.items.filter((i) => i.kind === 'fill')
    expect(serialize(summary.autoFilled)).toEqual(
      serialize(allFills.filter((i) => i.kind === 'fill' && i.source === 'adapter')),
    )
    expect(serialize(summary.heuristicGuessed)).toEqual(
      serialize(allFills.filter((i) => i.kind === 'fill' && i.source === 'heuristic')),
    )
    expect(summary.autoFilled.length + summary.heuristicGuessed.length).toBe(allFills.length)
  })

  it('「仍为空的必填」恰好是 blocking 缺口的投影 —— 非 blocking 缺口（f-city）不进来', () => {
    expect(serialize(summary.emptyRequired)).toEqual(serialize(preview.blockingGaps))
    const keys = summary.emptyRequired.map((g) => g.key)
    expect(keys).toContain('f-emergency')
    expect(keys).toContain('f-captcha')
    expect(keys).not.toContain('f-city')
  })

  it('上传槽位与 digest 原样透传 —— 摘要不加工它们', () => {
    expect(summary.fileSlots).toEqual(preview.fileSlots)
    expect(summary.digest).toBe(preview.digest)
  })

  it('有适配器的表单：adapter 来源进「自动填的」，计数与预览分列一致', () => {
    resetPlatformAdaptersForTests()
    registerPlatformAdapter(MOCKBOARD_ADAPTER)
    const mbPlan = buildFillPlan(parseHtmlFixture(MOCKBOARD_FORM_HTML), fillTestArchive())
    const mbPreview = buildPreview(mbPlan)
    const mbSummary = buildSubmitSummary(mbPreview)

    expect(mbSummary.autoFilled.length).toBe(mbPreview.counts.fillByAdapter)
    expect(mbSummary.heuristicGuessed.length).toBe(mbPreview.counts.fillByHeuristic)
    expect(mbSummary.autoFilled.length).toBeGreaterThan(0)
    expect(mbSummary.autoFilled.every((f) => f.source === 'adapter')).toBe(true)
    expect(mbSummary.heuristicGuessed.every((f) => f.source === 'heuristic')).toBe(true)
    resetPlatformAdaptersForTests()
  })
})

describe('createSubmitGate / releaseSubmit —— 只拦截一次，放行由用户点击', () => {
  const plan = buildFillPlan(parseHtmlFixture(GENERIC_FORM_HTML), fillTestArchive())
  const summary = buildSubmitSummary(buildPreview(plan))

  it('创建门即拦截：初始未放行；releaseSubmit 之后标记已放行，凭据 digest 与摘要一致', () => {
    const gate = createSubmitGate(summary)
    expect(gate.released).toBe(false)
    const release = releaseSubmit(gate)
    expect(gate.released).toBe(true)
    expect(release.digest).toBe(summary.digest)
  })

  it('只拦截一次 = 一次放行：同一道门第二次 releaseSubmit 抛错', () => {
    const gate = createSubmitGate(summary)
    releaseSubmit(gate)
    expect(() => releaseSubmit(gate)).toThrow()
  })

  it('凭据只能由真门产出：不是 createSubmitGate 产出的对象，releaseSubmit 直接拒绝', () => {
    const impostor = { digest: summary.digest, summary, released: false }
    expect(() => releaseSubmit(impostor as never)).toThrow()
  })

  it('verifySubmitRelease：真凭据通过；digest 对不上（拦截后页面变过）→ 旧凭据作废', () => {
    const gate = createSubmitGate(summary)
    const release = releaseSubmit(gate)
    expect(() => verifySubmitRelease(release, summary)).not.toThrow()

    const changedPlan: typeof plan = {
      items: plan.items.map((i) =>
        i.kind === 'fill' && i.key === 'f-name' ? { ...i, value: '张智远2' } : i,
      ),
    }
    const changedSummary = buildSubmitSummary(buildPreview(changedPlan))
    expect(changedSummary.digest).not.toBe(summary.digest)
    expect(() => verifySubmitRelease(release, changedSummary)).toThrow()
  })

  it('伪造凭据（缺品牌标记）在 verifySubmitRelease 处被拦下', () => {
    const forged = { digest: summary.digest } as unknown as SubmitRelease
    expect(() => verifySubmitRelease(forged, summary)).toThrow()
  })

  it('编译期门：缺品牌字段的对象字面量造不出合法凭据', () => {
    expect(() => {
      // @ts-expect-error 凭据只能由 releaseSubmit 产出：
      // 缺品牌字段的对象字面量在编译期就该被拦下，这里故意不改。
      const forged: SubmitRelease = { digest: summary.digest }
      void forged
    }).toBeDefined()
  })
})
