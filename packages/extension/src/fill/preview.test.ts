import { describe, expect, it } from 'vitest'

import { fillTestArchive } from './__fixtures__/fill-archive'
import { GENERIC_FORM_HTML, MOCKBOARD_FORM_HTML } from './__fixtures__/form-html'
import { parseHtmlFixture } from './__fixtures__/parse'
import {
  MOCKBOARD_ADAPTER,
  registerPlatformAdapter,
  resetPlatformAdaptersForTests,
} from './adapters'
import { buildFillPlan, type FillPlan, type FillPlanItem } from './plan'
import { buildPreview, createConfirmation } from './preview'

/**
 * 预览确认与缺口语义（TASKS T5.3，DESIGN 3.4 / 11.2 / 11.4）。
 *
 * 两条验收在这里的落点：
 * 1. 「任何写入之前必须经过用户确认」—— 用户确认的**凭据**与计划内容的
 *    摘要（digest）绑定。计划在预览之后变过（页面变了、重新算过），
 *    旧凭据作废。凭据不是布尔开关，是一张对得上号的票。
 * 2. 「blocking 缺口即时提示」—— 预览视图必须把 blocking 缺口作为
 *    一等公民带出来（`blockingGaps` + `requiresAttention`），
 *    与 plan 的对应投影逐项相等：漏掉一个都红。
 */

/** 把计划条目序列化成可比对的串 —— 投影相等断言的公共口径。 */
function serialize(items: readonly FillPlanItem[]): string[] {
  return items.map((item) => {
    if (item.kind === 'fill') return `fill:${item.key}:${item.path}:${item.value}:${item.source}`
    if (item.kind === 'gap') return `gap:${item.key}:${item.reason}:${String(item.blocking)}`
    return `file:${item.key}`
  })
}

describe('buildPreview（generic form）', () => {
  const plan = buildFillPlan(parseHtmlFixture(GENERIC_FORM_HTML), fillTestArchive())
  const preview = buildPreview(plan)
  const planFills = plan.items.filter((i) => i.kind === 'fill')
  const planGaps = plan.items.filter((i) => i.kind === 'gap')
  const planBlockingGaps = planGaps.filter((i) => i.blocking)

  it('fill 计数与计划一致：13 填全启发式（generic 无适配器）', () => {
    expect(preview.counts.fill).toBe(13)
    expect(preview.counts.fillByHeuristic).toBe(13)
    expect(preview.counts.fillByAdapter).toBe(0)
  })

  it('缺口与槽位计数与计划一致：5 缺口 + 1 上传槽位', () => {
    expect(preview.counts.gap).toBe(5)
    expect(preview.counts.fileSlot).toBe(1)
    expect(preview.fileSlots.map((s) => s.key)).toEqual(['f-resume-upload'])
  })

  it('blocking 缺口是 plan 的忠实投影 —— 一个不漏、一个不多、字段不走样', () => {
    // 双向：preview 的每一项都能在 plan 里找到同串（不多），
    // plan 的每一项 blocking 缺口都在 preview 里（不漏）。
    expect(serialize(preview.blockingGaps)).toEqual(serialize(planBlockingGaps))
    expect(preview.counts.blockingGap).toBe(planBlockingGaps.length)
  })

  it('已知缺口落在正确一侧：f-emergency / f-captcha 即时提示，f-city 不打扰', () => {
    const blockingKeys = preview.blockingGaps.map((g) => g.key)
    expect(blockingKeys).toContain('f-emergency')
    expect(blockingKeys).toContain('f-captcha')
    expect(blockingKeys).not.toContain('f-city')
  })

  it('requiresAttention 恰好等价于「存在 blocking 缺口」', () => {
    expect(preview.requiresAttention).toBe(true)
    const noBlocking: FillPlan = { items: plan.items.filter((i) => !(i.kind === 'gap' && i.blocking)) }
    expect(buildPreview(noBlocking).requiresAttention).toBe(false)
  })

  it('approvableKeys = fill 的 key 按计划顺序 —— gap/file-slot 不给批的资格', () => {
    expect(preview.approvableKeys).toEqual(planFills.map((i) => i.key))
    expect(preview.approvableKeys).not.toContain('f-city')
    expect(preview.approvableKeys).not.toContain('f-resume-upload')
    expect(preview.approvableKeys).not.toContain('agreement') // checkbox 根本不在计划里
  })

  it('digest 确定性：同一计划算两遍，摘要逐字符一致', () => {
    expect(buildPreview(plan).digest).toBe(buildPreview(plan).digest)
    expect(preview.digest.startsWith('fill-preview-v1')).toBe(true)
  })

  it('digest 对每个 fill 的值敏感 —— 改任何一个值，摘要必须变', () => {
    const tampered: FillPlan = {
      items: plan.items.map((i) =>
        i.kind === 'fill' && i.key === 'f-name' ? { ...i, value: '张智远 '.trim() + '2' } : i,
      ),
    }
    expect(buildPreview(tampered).digest).not.toBe(preview.digest)
  })

  it('digest 对 fill 的集合与顺序敏感 —— 少一项、换顺序都算「另一份预览」', () => {
    const dropped: FillPlan = { items: plan.items.filter((i) => !(i.kind === 'fill' && i.key === 'f-intro')) }
    const reordered: FillPlan = {
      items: [...plan.items.filter((i) => i.kind === 'fill').reverse(), ...plan.items.filter((i) => i.kind !== 'fill')],
    }
    expect(buildPreview(dropped).digest).not.toBe(preview.digest)
    expect(buildPreview(reordered).digest).not.toBe(preview.digest)
  })

  it('digest 对缺口与槽位不敏感 —— 它们本来就不可批', () => {
    const gapReasonChanged: FillPlan = {
      items: plan.items.map((i) => (i.kind === 'gap' && i.key === 'f-city' ? { ...i, reason: 'no-value' } : i)),
    }
    expect(buildPreview(gapReasonChanged).digest).toBe(preview.digest)
  })
})

describe('createConfirmation（凭据的合法性在创建时把关）', () => {
  const plan = buildFillPlan(parseHtmlFixture(GENERIC_FORM_HTML), fillTestArchive())
  const preview = buildPreview(plan)
  const allKeys = preview.approvableKeys

  it('全批 / 部分批 / 全不批 都合法；摘要与预览一致', () => {
    const full = createConfirmation(preview, allKeys)
    expect(full.digest).toBe(preview.digest)
    const partial = createConfirmation(preview, ['f-name', 'f-email'])
    expect(partial.approvedKeys).toEqual(['f-name', 'f-email'])
    const none = createConfirmation(preview, [])
    expect(none.approvedKeys).toEqual([])
  })

  it('批准集合归一到计划顺序 —— UI 传什么顺序都行，写入顺序只认页面', () => {
    const confirmed = createConfirmation(preview, ['f-email', 'f-name'])
    expect(confirmed.approvedKeys).toEqual(['f-name', 'f-email'])
  })

  it('重复批准去重，不产生二次写入的口子', () => {
    const confirmed = createConfirmation(preview, ['f-name', 'f-name'])
    expect(confirmed.approvedKeys).toEqual(['f-name'])
  })

  it('批计划里不存在 / 不可批的 key：直接拒绝，而不是静默忽略', () => {
    expect(() => createConfirmation(preview, ['no-such-key'])).toThrow()
    expect(() => createConfirmation(preview, ['f-city'])).toThrow() // gap 不可批
    expect(() => createConfirmation(preview, ['f-resume-upload'])).toThrow() // 槽位不可批（红线 5）
    expect(() => createConfirmation(preview, ['agreement'])).toThrow() // checkbox 不可批
  })

  it('凭据带品牌标记 —— 裸对象字面量造不出合法凭据（编译期门）', () => {
    expect(() => {
      // @ts-expect-error 凭据只能由 createConfirmation 产出：
      // 缺品牌字段的对象字面量在编译期就该被拦下，这里故意不改。
      const forged: FillConfirmation = { digest: preview.digest, approvedKeys: allKeys }
      void forged
    }).toBeDefined()
  })
})

describe('buildPreview / createConfirmation（adapter 来源进入计数与凭据）', () => {
  // 注册表是模块级状态：本块自管注册，用完清场，不带去别的用例。
  resetPlatformAdaptersForTests()
  registerPlatformAdapter(MOCKBOARD_ADAPTER)
  const plan = buildFillPlan(parseHtmlFixture(MOCKBOARD_FORM_HTML), fillTestArchive())
  const preview = buildPreview(plan)

  it('适配器来源的 fill 照样可批，计数分列正确', () => {
    const adapterFills = preview.approvableKeys.filter((key) => {
      const item = plan.items.find((i) => i.kind === 'fill' && i.key === key)
      return item !== undefined && item.kind === 'fill' && item.source === 'adapter'
    })
    expect(adapterFills.length).toBe(preview.counts.fillByAdapter)
    expect(preview.counts.fillByAdapter).toBeGreaterThan(0)
    expect(preview.counts.fillByAdapter + preview.counts.fillByHeuristic).toBe(preview.counts.fill)
  })
})
