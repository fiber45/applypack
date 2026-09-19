import { beforeEach, describe, expect, it } from 'vitest'

import { fillTestArchive } from './__fixtures__/fill-archive'
import {
  DEGRADED_FORM_HTML,
  GENERIC_FORM_HTML,
  MOCKBOARD_FORM_HTML,
} from './__fixtures__/form-html'
import { parseHtmlFixture } from './__fixtures__/parse'
import * as fillModule from './index'
import {
  MOCKBOARD_ADAPTER,
  detectPlatformAdapter,
  registerPlatformAdapter,
  resetPlatformAdaptersForTests,
} from './adapters'
import { buildFillPlan } from './plan'

/**
 * 适配器注册表（DESIGN 3.4：命中已知平台用精确选择器，长尾走启发式）。
 *
 * 关键断言有三组：命中（adapter 来源）、兜底（同一计划里未覆盖字段仍 heuristic）、
 * 降级（平台改版 → 选择器全空 → 一切照旧启发式）。第三组是 DESIGN 232
 * 「适配器随平台改版失效」那条风险的直接答案 —— 不是文档，是测试。
 */
describe('适配器注册表', () => {
  beforeEach(() => {
    resetPlatformAdaptersForTests()
    registerPlatformAdapter(MOCKBOARD_ADAPTER)
  })

  it('无平台标记的表单检测为 null —— generic 表单走纯启发式', () => {
    expect(detectPlatformAdapter(parseHtmlFixture(GENERIC_FORM_HTML))).toBeNull()
  })

  it('data-platform 标记命中注册表中的适配器', () => {
    const adapter = detectPlatformAdapter(parseHtmlFixture(MOCKBOARD_FORM_HTML))
    expect(adapter?.id).toBe('mockboard')
  })

  it('适配器覆盖的字段：path 来自精确选择器，source 标记为 adapter', () => {
    const plan = buildFillPlan(parseHtmlFixture(MOCKBOARD_FORM_HTML), fillTestArchive())
    const fills = plan.items.filter((i) => i.kind === 'fill')
    const byKey = new Map(fills.map((i) => [i.key, i]))

    // mb-name 没有任何文案线索（无 label / aria / 命不中的 name）——
    // 纯启发式对它是 no-catalog-match，只有适配器救得了它
    expect(byKey.get('mb-name')).toMatchObject({
      path: 'basics.name.zh',
      source: 'adapter',
      value: '张智远',
    })
    expect(byKey.get('mb-phone')).toMatchObject({
      path: 'basics.contact.phone',
      source: 'adapter',
    })
    expect(byKey.get('mb-email')).toMatchObject({
      path: 'basics.contact.email',
      source: 'adapter',
    })
  })

  it('同一计划里适配器没覆盖的字段照走启发式 —— 两种来源混跑且互不覆盖', () => {
    const plan = buildFillPlan(parseHtmlFixture(MOCKBOARD_FORM_HTML), fillTestArchive())
    const fills = plan.items.filter((i) => i.kind === 'fill')
    const byKey = new Map(fills.map((i) => [i.key, i]))

    expect(byKey.get('mb-intent')).toMatchObject({
      path: 'basics.label.zh',
      source: 'heuristic',
    })
    expect(byKey.get('mb-degree')).toMatchObject({
      path: 'education.0.studyType.zh',
      source: 'heuristic',
      value: 'bachelor',
    })
  })

  it('平台改版（选择器全部失效）→ 快速降级到启发式，字段照常填', () => {
    const plan = buildFillPlan(parseHtmlFixture(DEGRADED_FORM_HTML), fillTestArchive())
    const fills = plan.items.filter((i) => i.kind === 'fill')
    expect(fills.length).toBeGreaterThanOrEqual(2)
    expect(fills.every((i) => i.source === 'heuristic')).toBe(true)
    const byKey = new Map(fills.map((i) => [i.key, i]))
    expect(byKey.get('d-name')?.path).toBe('basics.name.zh')
    expect(byKey.get('d-phone')?.path).toBe('basics.contact.phone')
  })

  it('未注册任何适配器时 buildFillPlan 照常工作（注册表是可选项）', () => {
    resetPlatformAdaptersForTests()
    const plan = buildFillPlan(parseHtmlFixture(MOCKBOARD_FORM_HTML), fillTestArchive())
    const fills = plan.items.filter((i) => i.kind === 'fill')
    // mb-name 没有线索 → no-catalog-match；其余走启发式
    expect(fills.every((i) => i.source === 'heuristic')).toBe(true)
    const gaps = plan.items.filter((i) => i.kind === 'gap')
    expect(gaps.find((i) => i.key === 'mb-name')?.reason).toBe('no-catalog-match')
  })
})

describe('导出面（想加新出口，必须先改这里）', () => {
  it('fill 模块只导出填充引擎的构造面，不含任何「直接写 DOM」的函数', () => {
    // 注意：`Object.keys` 只含值导出 —— 类型导出在运行时不存在，
    // 所以这条断言管的是「函数与数据出口」，类型面由 typecheck 管。
    expect(Object.keys(fillModule).sort()).toEqual([
      'BUILTIN_PLATFORM_ADAPTERS',
      'FILL_CATALOG',
      'MOCKBOARD_ADAPTER',
      'applyFillPlan',
      'asDomDocument',
      'buildFillPlan',
      'buildPreview',
      'buildUploadNotices',
      'classifyUploadSlot',
      'createConfirmation',
      'detectPlatformAdapter',
      'extractFieldFeatures',
      'isFillableKind',
      'registerBuiltinPlatformAdapters',
      'registerPlatformAdapter',
      'resetPlatformAdaptersForTests',
    ])
  })
})
