import { describe, expect, it } from 'vitest'

import { fillTestArchive } from './__fixtures__/fill-archive'
import { GENERIC_FORM_HTML } from './__fixtures__/form-html'
import { parseHtmlFixture } from './__fixtures__/parse'
import { FILL_CATALOG } from './catalog'
import { buildFillPlan, type FillPlan } from './plan'
import {
  BACKFILL_PATHS,
  applyBackfill,
  buildBackfillProposal,
  detectBackfillCandidates,
} from './backfill'
import { serializeArchive, type ArchiveV1 } from '../../../core/src/schema/index'

/**
 * 回填闭环（TASKS T5.6，DESIGN 11.3「产品的核心价值闭环：填一次，以后自动」）。
 *
 * 三条验收在这里的落点：
 * 1. 「手填新字段 → 询问」—— `detectBackfillCandidates` 对比提交时刻的
 *    表单值与计划：改了已填字段（edited）、填了缺口字段（manual）都算
 *    手填；`buildBackfillProposal` 按**档案现值**分诊：档案没有 → new，
 *    档案有且不同 → conflict，恰好相同 → same（无信息量，不进 proposal）。
 * 2. 「不静默保存」—— `applyBackfill` 只写 decisions 里显式点头的条目；
 *    空决策 = 档案逐字节不变。检测出候选与写回档案之间隔着一次用户确认，
 *    中间没有直达路径。
 * 3. 「冲突不自动覆盖，交给用户选」—— conflict 条目没有决策 = 保留
 *    档案值（keep 是缺省，不是 replace）；展示两者是 UI 的事，
 *    「选了才覆盖」在这里是结构。
 *
 * 「写回并重建索引」的可执行落点：写回后的档案用 FILL_CATALOG 的
 * `read` 能读回页面值 —— 词汇表下一次跑 plan 就能自动填上它。
 * 产出永远过一遍 schema round-trip（严格模式）：
 * 手填值写不进档案形状，就在这里炸，而不是等保存密文时才炸。
 */

/** 提交时刻的表单值：fill 用计划值做基底，gap 缺省空串，overrides 模拟用户手填。 */
function pageValuesFrom(plan: FillPlan, overrides: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const item of plan.items) {
    if (item.kind === 'fill') values[item.key] = item.value
    else if (item.kind === 'gap') values[item.key] = ''
  }
  return { ...values, ...overrides }
}

function planOf(archive: ArchiveV1 = fillTestArchive()): FillPlan {
  return buildFillPlan(parseHtmlFixture(GENERIC_FORM_HTML), archive)
}

describe('detectBackfillCandidates —— 谁算「手填」', () => {
  const plan = planOf()

  it('改了已填字段算手填（edited），target 带目录 path', () => {
    const candidates = detectBackfillCandidates(
      plan,
      pageValuesFrom(plan, { 'f-phone': '13900139000' }),
    )
    const edited = candidates.filter((c) => c.key === 'f-phone')
    expect(edited).toHaveLength(1)
    expect(edited[0]).toMatchObject({
      source: 'edited',
      target: { kind: 'path', path: 'basics.contact.phone' },
      pageValue: '13900139000',
    })
  })

  it('填了有目录 path 的缺口字段算手填（manual）—— f-city（option-mismatch）', () => {
    const candidates = detectBackfillCandidates(
      plan,
      pageValuesFrom(plan, { 'f-city': '杭州' }),
    )
    const manual = candidates.filter((c) => c.key === 'f-city')
    expect(manual).toHaveLength(1)
    expect(manual[0]).toMatchObject({
      source: 'manual',
      target: { kind: 'path', path: 'basics.location.city' },
      pageValue: '杭州',
    })
  })

  it('填了目录认不出的字段 → customFields 候选（语义未知 ⇒ 默认 B 级）', () => {
    const candidates = detectBackfillCandidates(
      plan,
      pageValuesFrom(plan, { 'f-captcha': '8321' }),
    )
    const custom = candidates.filter((c) => c.key === 'f-captcha')
    expect(custom).toHaveLength(1)
    expect(custom[0]).toMatchObject({
      source: 'manual',
      target: { kind: 'custom', cfKey: 'f-captcha' },
      pageValue: '8321',
    })
  })

  it('outbid 缺口不产生候选 —— path 归属已被计划判为不可信，存错比不存更糟', () => {
    // 「紧急联系人电话」被词汇表误配到 basics.contact.phone 又被挤掉；
    // 用户手填它绝不能回填进 phone 字段。
    const candidates = detectBackfillCandidates(
      plan,
      pageValuesFrom(plan, { 'f-emergency': '13700000000', 'f-tel-1': '01012345678' }),
    )
    expect(candidates.find((c) => c.key === 'f-emergency')).toBeUndefined()
    expect(candidates.find((c) => c.key === 'f-tel-1')).toBeUndefined()
  })

  it('页面值与计划一致、空串（清空不算新信息）、file-slot —— 都不产生候选', () => {
    const candidates = detectBackfillCandidates(plan, pageValuesFrom(plan, {}))
    expect(candidates).toEqual([])
    const withEmpty = detectBackfillCandidates(
      plan,
      pageValuesFrom(plan, { 'f-phone': '', 'f-emergency': '  ' }),
    )
    expect(withEmpty).toEqual([])
  })
})

describe('buildBackfillProposal —— 按档案现值分诊', () => {
  const plan = planOf()
  const archive = fillTestArchive()

  it('档案没有该值 → new；档案有且不同 → conflict（两个值都带上，UI 展示用）', () => {
    const noPhone: ArchiveV1 = {
      ...archive,
      basics: { ...archive.basics, contact: { ...archive.basics.contact, phone: undefined } },
    }
    const proposal = buildBackfillProposal(
      detectBackfillCandidates(planOf(noPhone), pageValuesFrom(planOf(noPhone), { 'f-phone': '13900139000' })),
      noPhone,
    )
    const phone = proposal.items.find((i) => i.id === 'f-phone')
    expect(phone).toMatchObject({
      status: 'new',
      archiveValue: null,
      pageValue: '13900139000',
      target: { kind: 'path', path: 'basics.contact.phone' },
    })

    const conflictProposal = buildBackfillProposal(
      detectBackfillCandidates(plan, pageValuesFrom(plan, { 'f-phone': '13900139000', 'f-city': '杭州' })),
      archive,
    )
    expect(conflictProposal.items.find((i) => i.id === 'f-phone')).toMatchObject({
      status: 'conflict',
      archiveValue: '13800138000',
    })
    expect(conflictProposal.items.find((i) => i.id === 'f-city')).toMatchObject({
      status: 'conflict',
      archiveValue: '成都',
      pageValue: '杭州',
    })
  })

  it('页面值恰好等于档案值（same）→ 不进 proposal，没东西可问', () => {
    const proposal = buildBackfillProposal(
      detectBackfillCandidates(plan, pageValuesFrom(plan, { 'f-city': '成都' })),
      archive,
    )
    expect(proposal.items).toEqual([])
  })

  it('customFields 已有同值 → 同样排除；已有不同值 → conflict', () => {
    const withCustom: ArchiveV1 = { ...archive, customFields: { 'f-captcha': '8321' } }
    const same = buildBackfillProposal(
      detectBackfillCandidates(planOf(withCustom), pageValuesFrom(planOf(withCustom), { 'f-captcha': '8321' })),
      withCustom,
    )
    expect(same.items).toEqual([])

    const conflict = buildBackfillProposal(
      detectBackfillCandidates(plan, pageValuesFrom(plan, { 'f-captcha': '4567' })),
      withCustom,
    )
    expect(conflict.items.find((i) => i.id === 'f-captcha')).toMatchObject({
      status: 'conflict',
      archiveValue: '8321',
      target: { kind: 'custom', cfKey: 'f-captcha' },
    })
  })

  it('指纹绑定检测时的档案 —— 写回前可验证档案没被别人改过', () => {
    const proposal = buildBackfillProposal([], archive)
    expect(proposal.fingerprint).toBe(serializeArchive(archive))
    expect(proposal.items).toEqual([])
  })
})

describe('applyBackfill —— 只写显式批准的，冲突不选即保留', () => {
  const archive = fillTestArchive()
  const plan = planOf()
  const pageValues = pageValuesFrom(plan, {
    'f-phone': '13900139000',
    'f-city': '杭州',
    'f-captcha': '8321',
  })
  const proposal = buildBackfillProposal(detectBackfillCandidates(plan, pageValues), archive)

  it('空决策 = 档案逐字节不变：new 不写入（不静默保存），conflict 保留原值（不自动覆盖）', () => {
    const result = applyBackfill(archive, proposal, [])
    expect(serializeArchive(result)).toBe(serializeArchive(archive))
  })

  it('显式决策才写回：path 值更新、其余字段不动', () => {
    const result = applyBackfill(archive, proposal, [{ id: 'f-phone' }])
    expect(result.basics.contact.phone).toBe('13900139000')
    expect(result.basics.contact.email).toBe('zhang@example.com')
    expect(result.basics.location?.city).toBe('成都') // f-city 没决策 → 保留档案值
    expect(result.customFields['f-captcha']).toBeUndefined()
  })

  it('冲突条目用户选了新值才覆盖 —— 这是「展示两者让用户选」的另一半', () => {
    const result = applyBackfill(archive, proposal, [{ id: 'f-city' }])
    expect(result.basics.location?.city).toBe('杭州')
    expect(result.basics.contact.phone).toBe('13800138000') // 没决策 → 保留
  })

  it('customFields 写回：批准后键值进入档案（语义未知 ⇒ 默认 B 级，与分级策略一致）', () => {
    const result = applyBackfill(archive, proposal, [{ id: 'f-captcha' }])
    expect(result.customFields['f-captcha']).toBe('8321')
    expect(result.basics.contact.phone).toBe('13800138000')
  })

  it('批准 proposal 里不存在的 id → 抛错（越权不静默忽略）', () => {
    expect(() => applyBackfill(archive, proposal, [{ id: 'no-such-key' }])).toThrow()
  })

  it('检测之后档案变过（指纹对不上）→ 旧 proposal 作废，重新检测', () => {
    const changed: ArchiveV1 = {
      ...archive,
      basics: { ...archive.basics, contact: { ...archive.basics.contact, email: 'new@example.com' } },
    }
    expect(() => applyBackfill(changed, proposal, [{ id: 'f-phone' }])).toThrow()
  })

  it('产出必是合法档案（严格模式 round-trip）—— 手填值写不进档案形状就在这里炸', () => {
    const result = applyBackfill(archive, proposal, [
      { id: 'f-phone' },
      { id: 'f-city' },
      { id: 'f-captcha' },
    ])
    expect(() => serializeArchive(result)).not.toThrow()
  })
})

describe('回填闭环 —— 「填一次，以后自动」的可执行判定', () => {
  const plan = planOf()
  const archive = fillTestArchive()
  const pageValues = pageValuesFrom(plan, {
    'f-phone': '13900139000',
    'f-city': '杭州',
    'f-captcha': '8321',
  })
  const proposal = buildBackfillProposal(detectBackfillCandidates(plan, pageValues), archive)
  const result = applyBackfill(archive, proposal, [{ id: 'f-phone' }, { id: 'f-city' }, { id: 'f-captcha' }])

  it('写回后 FILL_CATALOG 的 read 能读回页面值 —— 下一次 plan 自动填上', () => {
    const read = (path: string): string | null => {
      const entry = FILL_CATALOG.find((e) => e.path === path)
      if (entry === undefined) throw new Error(`目录里没有 ${path}`)
      return entry.read(result)
    }
    expect(read('basics.contact.phone')).toBe('13900139000')
    expect(read('basics.location.city')).toBe('杭州')
    expect(result.customFields['f-captcha']).toBe('8321')
  })

  it('写回白名单与目录对称 —— 目录加了条目忘了写回通道（或反向），这里先红（防漂移）', () => {
    expect([...BACKFILL_PATHS].sort()).toEqual(FILL_CATALOG.map((e) => e.path).sort())
  })
})
