import { describe, expect, it } from 'vitest'

import { fillTestArchive } from './__fixtures__/fill-archive'
import { GENERIC_FORM_HTML } from './__fixtures__/form-html'
import { parseHtmlFixture } from './__fixtures__/parse'
import { buildFillPlan, type FillPlan } from './plan'
import { buildPreview, createConfirmation, type FillConfirmation, type FillPreview } from './preview'
import { applyFillPlan, type FillWriter } from './apply'

/**
 * 写入门（TASKS T5.3 验收 1：任何写入之前必须经过用户确认）。
 *
 * 这里钉的是**纯逻辑层的门**：从「计划」到「writer 被调用」之间
 * 只有一条路，而那条路上必须验过一张与当前计划内容摘要绑定的
 * 凭据。伪造凭据、张冠李戴的凭据（页面变过之后还拿旧票进门）、
 * 越权批（gap / file-slot）——三种走法全在测试里被现场演示为红灯。
 * DOM 写入本体（`FillWriter`）是平台接缝：内容脚本给真实现，
 * 测试给间谍，谁也不 import 谁（T1.5 模式）。
 */

function spyWriter(): FillWriter & { calls: Array<{ key: string; value: string }> } {
  const calls: Array<{ key: string; value: string }> = []
  return { calls, setValue(key, value) { calls.push({ key, value }) } }
}

/** 全新算一遍 generic 计划 + 预览。 */
function freshPlan(): { plan: FillPlan; preview: FillPreview } {
  const plan = buildFillPlan(parseHtmlFixture(GENERIC_FORM_HTML), fillTestArchive())
  return { plan, preview: buildPreview(plan) }
}

describe('applyFillPlan（合法路径）', () => {
  it('全批：writer 按计划顺序逐 key 收到准确值，一次不多', () => {
    const { plan, preview } = freshPlan()
    const writer = spyWriter()
    const result = applyFillPlan(plan, createConfirmation(preview, preview.approvableKeys), writer)

    const fillItems = plan.items.filter((i) => i.kind === 'fill')
    expect(result.appliedKeys).toEqual(fillItems.map((i) => i.key))
    expect(result.skippedKeys).toEqual([])
    expect(writer.calls).toHaveLength(fillItems.length)
    expect(writer.calls.map((c) => c.key)).toEqual(fillItems.map((i) => i.key))
    // 值逐项可对账（抽查含 select 的 value 映射）：
    const byKey = new Map(writer.calls.map((c) => [c.key, c.value]))
    expect(byKey.get('f-name')).toBe('张智远')
    expect(byKey.get('f-gender')).toBe('M')
    expect(byKey.get('f-salary')).toBe('25000')
  })

  it('部分批：只写批过的；没批的进 skippedKeys，writer 对它们保持沉默', () => {
    const { plan, preview } = freshPlan()
    const writer = spyWriter()
    const result = applyFillPlan(plan, createConfirmation(preview, ['f-name', 'f-email']), writer)

    expect(result.appliedKeys).toEqual(['f-name', 'f-email'])
    expect(writer.calls.map((c) => c.key)).toEqual(['f-name', 'f-email'])
    const skipped = new Set(result.skippedKeys)
    expect(skipped.has('f-phone')).toBe(true)
    expect(skipped.size).toBe(11) // 13 fill - 2 批
  })

  it('全不批是合法的用户决定：零写入、不报错 —— 「一个都不填」被尊重', () => {
    const { plan, preview } = freshPlan()
    const writer = spyWriter()
    const result = applyFillPlan(plan, createConfirmation(preview, []), writer)
    expect(result.appliedKeys).toEqual([])
    expect(writer.calls).toHaveLength(0)
  })

  it('checkbox 与 file-slot 永远到不了 writer —— 结构上无路可走', () => {
    const { plan, preview } = freshPlan()
    const writer = spyWriter()
    applyFillPlan(plan, createConfirmation(preview, preview.approvableKeys), writer)
    const writtenKeys = new Set(writer.calls.map((c) => c.key))
    expect(writtenKeys.has('agreement')).toBe(false)
    expect(writtenKeys.has('f-resume-upload')).toBe(false)
  })
})

describe('applyFillPlan（门的三种非法走法，全部零写入）', () => {
  it('伪造凭据（形状对、摘要错）：throw 且 writer 未被调用', () => {
    const { plan } = freshPlan()
    const writer = spyWriter()
    // 运行时伪造（绕过品牌）：simulate 一个手搓对象。
    // 编译期伪造由 preview.test.ts 的 @ts-expect-error 钉住。
    const forged = {
      digest: 'fill-preview-v1:not-the-real-thing',
      approvedKeys: ['f-name'],
    } as unknown as FillConfirmation
    expect(() => applyFillPlan(plan, forged, writer)).toThrow(/摘要|确认/)
    expect(writer.calls).toHaveLength(0)
  })

  it('张冠李戴的凭据（计划变过之后拿旧票进门）：throw 且零写入', () => {
    const { plan, preview } = freshPlan()
    const confirmation = createConfirmation(preview, preview.approvableKeys)
    // 模拟「页面在预览之后变了」：档案换了个手机号，计划重算。
    const archive2 = fillTestArchive()
    const changedPlan: FillPlan = {
      items: plan.items.map((i) => (i.kind === 'fill' && i.key === 'f-phone' ? { ...i, value: '13900139000' } : i)),
    }
    const writer = spyWriter()
    expect(() => applyFillPlan(changedPlan, confirmation, writer)).toThrow()
    expect(writer.calls).toHaveLength(0)
    void archive2
  })

  it('批了计划里不存在的 key（凭据被裁剪过）：throw 且零写入', () => {
    const { plan, preview } = freshPlan()
    const confirmation = createConfirmation(preview, ['f-name'])
    // 摘要保持原样，但批准集合被塞进了 gap key —— 批的资格集合被篡改。
    const trimmed = {
      digest: confirmation.digest,
      approvedKeys: ['f-name', 'f-city'],
    } as unknown as FillConfirmation
    const writer = spyWriter()
    expect(() => applyFillPlan(plan, trimmed, writer)).toThrow()
    expect(writer.calls).toHaveLength(0)
  })
})
