import { describe, expect, it } from 'vitest'

import { fieldPolicyFor } from '../../../core/src/schema/index'
import { fillTestArchive } from './__fixtures__/fill-archive'
import {
  AMBIGUOUS_FORM_HTML,
  GENERIC_FORM_HTML,
} from './__fixtures__/form-html'
import { parseHtmlFixture } from './__fixtures__/parse'
import { FILL_CATALOG, isFillableKind } from './catalog'
import { scoreCatalogEntry, type ScorableFieldFeature } from './heuristics'
import { buildFillPlan } from './plan'

/**
 * 填充计划 —— 启发式匹配的主判据（TASKS T5.1「字段匹配有准确率断言」）。
 *
 * 准确率不是报一个百分比数字就完事：**逐字段 ground truth 精确相等**，
 * 双向都查 —— 多填（错配）与少填（漏配）都红。项目立场是
 * 「填错比不填更糟」（DESIGN 3.4），所以错配在断言里不是统计项，是硬失败。
 */
describe('buildFillPlan（generic form · ground truth）', () => {
  const plan = buildFillPlan(parseHtmlFixture(GENERIC_FORM_HTML), fillTestArchive())
  const fills = plan.items.filter((i) => i.kind === 'fill')
  const gaps = plan.items.filter((i) => i.kind === 'gap')
  const fillByKey = new Map(fills.map((i) => [i.key, i]))
  const gapByKey = new Map(gaps.map((i) => [i.key, i]))

  /** 人工核对的 ground truth：每个期望被填的字段 → 档案路径 */
  const EXPECTED_FILLS: Readonly<Record<string, string>> = {
    'f-name': 'basics.name.zh',
    'f-intent': 'basics.label.zh',
    'f-phone': 'basics.contact.phone',
    'f-email': 'basics.contact.email',
    'f-wechat': 'basics.contact.wechat',
    'f-gender': 'basics.identity.gender',
    'f-birth': 'basics.identity.birthDate',
    'f-degree': 'education.0.studyType.zh',
    'f-school': 'education.0.institution',
    'f-major': 'education.0.area.zh',
    'f-graduate': 'education.0.endDate',
    'f-salary': 'basics.desiredSalary.amount',
    'f-intro': 'basics.summary.zh',
  }

  /** 期望**不被**填的字段 → 预期的缺口原因 */
  const EXPECTED_GAPS: Readonly<Record<string, string>> = {
    'f-city': 'option-mismatch',
    'f-emergency': 'outbid',
    'f-tel-1': 'outbid',
    'f-tel-2': 'outbid',
    'f-captcha': 'no-catalog-match',
  }

  it('正向下：每个 fill 的 key→path 与 ground truth 逐项相等', () => {
    const actual: Record<string, string> = {}
    for (const item of fills) actual[item.key] = item.path
    expect(actual).toEqual(EXPECTED_FILLS)
  })

  it('反向上：ground truth 里的每一项都真的被填了 —— 漏配也红', () => {
    expect(fills.map((i) => i.key).sort()).toEqual(
      Object.keys(EXPECTED_FILLS).sort(),
    )
  })

  it('缺口字段的原因与预期逐项一致，且 gap 不冒充 fill', () => {
    const actual: Record<string, string> = {}
    for (const item of gaps) actual[item.key] = item.reason
    expect(actual).toEqual(EXPECTED_GAPS)
  })

  it('计划完备：每个可填特征要么 fill 要么 gap，除 file/checkbox 外无第三种下场', () => {
    const accounted = new Set([...fillByKey.keys(), ...gapByKey.keys()])
    // file-slot 单独一类，不算缺口
    const fileSlots = plan.items.filter((i) => i.kind === 'file-slot')
    expect(fileSlots.map((i) => i.key)).toEqual(['f-resume-upload'])
    // checkbox（同意条款）不出现在任何条目里 —— 用户自己勾
    expect(accounted.has('agreement')).toBe(false)
  })

  it('填的值来自档案：明文可对账（含 select 的 value 映射与数字格式化）', () => {
    expect(fillByKey.get('f-name')?.value).toBe('张智远')
    expect(fillByKey.get('f-phone')?.value).toBe('13800138000')
    // select：按选项文本匹配（男），回填写 option 的 value
    expect(fillByKey.get('f-gender')?.value).toBe('M')
    expect(fillByKey.get('f-degree')?.value).toBe('bachelor')
    // 日期/月份原样传递（档案格式 YYYY / YYYY-MM / YYYY-MM-DD 与原生控件对齐）
    expect(fillByKey.get('f-birth')?.value).toBe('2001-06-15')
    expect(fillByKey.get('f-graduate')?.value).toBe('2024-06')
    // 数字：amount 是 number，回填串行化为字符串
    expect(fillByKey.get('f-salary')?.value).toBe('25000')
  })

  it('级别随条目走 —— 预览 UI 靠它区分「来自档案的哪一层」', () => {
    expect(fillByKey.get('f-phone')?.level).toBe('B')
    expect(fillByKey.get('f-gender')?.level).toBe('B')
    expect(fillByKey.get('f-intro')?.level).toBe('A')
    expect(fillByKey.get('f-degree')?.level).toBe('A')
  })

  it('无平台标记的表单，全部 fill 的 source 都是 heuristic', () => {
    expect(fills.every((i) => i.source === 'heuristic')).toBe(true)
  })

  it('blocking 语义：必填缺口即时标记，非必填缺口不打扰', () => {
    expect(gapByKey.get('f-emergency')?.blocking).toBe(true)
    expect(gapByKey.get('f-captcha')?.blocking).toBe(true)
    expect(gapByKey.get('f-city')?.blocking).toBe(false)
  })
})

describe('歧义语义（AMBIGUOUS_FORM）', () => {
  const plan = buildFillPlan(parseHtmlFixture(AMBIGUOUS_FORM_HTML), fillTestArchive())
  const fills = plan.items.filter((i) => i.kind === 'fill')
  const gaps = plan.items.filter((i) => i.kind === 'gap')

  it('两个同标签同类型的字段打平 → 都不填（填错比不填更糟）', () => {
    const telGaps = gaps.filter((i) => i.reason === 'ambiguous')
    expect(telGaps.map((i) => i.key).sort()).toEqual(['a-tel-1', 'a-tel-2'])
    expect(fills.filter((i) => i.path === 'basics.contact.phone')).toHaveLength(0)
  })

  it('同表单里无歧义的字段照常填 —— 歧义只隔离自己（正控）', () => {
    const email = fills.find((i) => i.key === 'a-email')
    expect(email?.path).toBe('basics.contact.email')
  })
})

describe('评分器（单元级正控 —— 主判据不是空转）', () => {
  const feature = (over: Partial<ScorableFieldFeature>): ScorableFieldFeature => ({
    kind: 'text',
    labels: [],
    name: null,
    id: null,
    placeholder: null,
    ...over,
  })

  it('标签精确命中同义词给最高分', () => {
    const phone = FILL_CATALOG.find((e) => e.path === 'basics.contact.phone')
    expect(scoreCatalogEntry(phone, feature({ labels: ['手机号'] }))).toBeGreaterThan(0)
    expect(scoreCatalogEntry(phone, feature({ labels: ['紧急联系人电话'] }))).toBeGreaterThan(0)
  })

  it('类型闸门是硬闸门：tel 输入框永远不可能接 email 的值', () => {
    const email = FILL_CATALOG.find((e) => e.path === 'basics.contact.email')
    expect(scoreCatalogEntry(email, feature({ kind: 'tel', labels: ['电子邮箱'] }))).toBe(0)
  })
})

describe('目录与分级策略的一致性（单一真相的两侧）', () => {
  it('每条目录的 level 与 core 分级策略一致，路径必须真实存在', () => {
    expect(FILL_CATALOG.length).toBeGreaterThanOrEqual(14)
    for (const entry of FILL_CATALOG) {
      const policy = fieldPolicyFor(entry.path)
      expect(policy, `目录路径 ${entry.path} 在分级策略里不存在`).not.toBeNull()
      expect(policy?.level).toBe(entry.level)
    }
  })

  it('isFillableKind 与目录的 kinds 口径一致：file/checkbox 不在任何目录条目里', () => {
    // Set<string>：has('file') 的意义就是「连字符串口径都查不到」，
    // 用窄类型会让这条断言在编译期变成不可写。
    const allKinds = new Set<string>(FILL_CATALOG.flatMap((e) => e.kinds))
    expect(allKinds.has('file')).toBe(false)
    expect(allKinds.has('checkbox')).toBe(false)
    expect(isFillableKind('file')).toBe(false)
    expect(isFillableKind('text')).toBe(true)
  })
})
