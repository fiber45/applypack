import { beforeEach, describe, expect, it } from 'vitest'

import { fillTestArchive } from './__fixtures__/fill-archive'
import {
  GENERIC_FORM_HTML,
  MOCKBOARD_FORM_HTML,
} from './__fixtures__/form-html'
import { parseHtmlFixture } from './__fixtures__/parse'
import { BEISEN_SNAPSHOT_HTML } from './__fixtures__/snapshot-beisen'
import { DAYEE_SNAPSHOT_HTML } from './__fixtures__/snapshot-dayee'
import { MOKA_SNAPSHOT_HTML } from './__fixtures__/snapshot-moka'
import {
  MOCKBOARD_ADAPTER,
  adapterBindings,
  detectPlatformAdapter,
  registerPlatformAdapter,
  resetPlatformAdaptersForTests,
} from './adapters'
import { extractFieldFeatures } from './features'
import { FILL_CATALOG } from './catalog'
import {
  BUILTIN_PLATFORM_ADAPTERS,
  registerBuiltinPlatformAdapters,
} from './platforms'
import { buildFillPlan } from './plan'

/**
 * 真实平台适配器（TASKS T5.2：北森 / Moka / 大易）。
 *
 * 四组判据，每组对着一种造假方式：
 *   1. 注册面    —— 适配器指向不存在的目录路径、空选择器（T5.1 的
 *                  plan.ts 防御分支在这里变成红灯，而不是静默跳过）
 *   2. 命中互斥  —— 两家适配器同时认领一个页面（标记撞了）
 *   3. 版本纪律  —— 平台改版后没重新采集快照就 bump 选择器
 *   4. CI 冒烟 + 逐字段 ground truth —— 选择器扑空、错配、漏配
 *
 * 快照是手工建模的近似（provisional），声明见 README「适配器与快照维护」；
 * 但**判据的性质不因 provisional 而放松**：精确相等、双向都查。
 */

const SNAPSHOT_HTML: Readonly<Record<string, string>> = {
  beisen: BEISEN_SNAPSHOT_HTML,
  moka: MOKA_SNAPSHOT_HTML,
  dayee: DAYEE_SNAPSHOT_HTML,
}

describe('注册面', () => {
  it('内置适配器恰好三家，id 与平台标记互不相同', () => {
    expect(BUILTIN_PLATFORM_ADAPTERS.map((a) => a.id)).toEqual([
      'beisen',
      'moka',
      'dayee',
    ])
    const markers = new Set(BUILTIN_PLATFORM_ADAPTERS.map((a) => a.platformMarker))
    expect(markers.size).toBe(BUILTIN_PLATFORM_ADAPTERS.length)
  })

  it('每个选择器的 path 都在目录里 —— 指向不存在路径的选择器在这里红', () => {
    const catalogPaths = new Set(FILL_CATALOG.map((e) => e.path))
    for (const adapter of BUILTIN_PLATFORM_ADAPTERS) {
      for (const path of Object.keys(adapter.selectors)) {
        expect(
          catalogPaths.has(path),
          `${adapter.id} 的选择器指向目录外的路径 ${path}`,
        ).toBe(true)
      }
    }
  })

  it('每家至少两条选择器且全部非空 —— 空选择器的适配器是空气', () => {
    for (const adapter of BUILTIN_PLATFORM_ADAPTERS) {
      const paths = Object.keys(adapter.selectors)
      expect(paths.length, `${adapter.id} 的选择器数量`).toBeGreaterThanOrEqual(2)
      for (const path of paths) {
        expect(
          adapter.selectors[path]?.length ?? 0,
          `${adapter.id} 的 ${path}`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('版本号形如主版本号（非空短串）—— 版本纪律的载体必须先存在', () => {
    for (const adapter of [...BUILTIN_PLATFORM_ADAPTERS, MOCKBOARD_ADAPTER]) {
      expect(adapter.version).toMatch(/^\d+$/)
    }
  })
})

describe('命中互斥', () => {
  beforeEach(() => {
    resetPlatformAdaptersForTests()
    registerBuiltinPlatformAdapters()
  })

  it('三家快照各自命中自家适配器 —— 标记撞车在这里暴露', () => {
    for (const adapter of BUILTIN_PLATFORM_ADAPTERS) {
      const detected = detectPlatformAdapter(parseHtmlFixture(SNAPSHOT_HTML[adapter.id] ?? ''))
      expect(detected?.id, `快照 ${adapter.id} 的命中者`).toBe(adapter.id)
    }
  })

  it('不命中别家快照、无标记表单与 mockboard 页面', () => {
    const foreign: ReadonlyArray<string> = [
      ...BUILTIN_PLATFORM_ADAPTERS.map((a) => SNAPSHOT_HTML[a.id] ?? ''),
      GENERIC_FORM_HTML,
      MOCKBOARD_FORM_HTML,
    ]
    for (const adapter of BUILTIN_PLATFORM_ADAPTERS) {
      for (const html of foreign) {
        if (html === SNAPSHOT_HTML[adapter.id]) continue
        resetPlatformAdaptersForTests()
        registerPlatformAdapter(adapter)
        expect(
          detectPlatformAdapter(parseHtmlFixture(html)),
          `${adapter.id} 不应命中别家页面`,
        ).toBeNull()
      }
    }
  })

  it('registerBuiltinPlatformAdapters 可注册全部三家，且重复注册被拒', () => {
    resetPlatformAdaptersForTests()
    registerBuiltinPlatformAdapters()
    expect(() => registerBuiltinPlatformAdapters()).toThrow(/已注册/)
  })
})

describe('版本纪律（选择器版本化，DESIGN 232）', () => {
  it('每份快照声明的采集版本与适配器版本一致 —— 改版没同步就在这里红', () => {
    for (const adapter of BUILTIN_PLATFORM_ADAPTERS) {
      const doc = parseHtmlFixture(SNAPSHOT_HTML[adapter.id] ?? '')
      const marker = doc.querySelectorAll(
        `[data-platform="${adapter.platformMarker}"]`,
      )[0]
      expect(
        marker?.getAttribute('data-platform-version'),
        `快照 ${adapter.id} 的 data-platform-version`,
      ).toBe(adapter.version)
    }
    // mockboard 与真实适配器共用同一套机制，一处不能少
    const doc = parseHtmlFixture(MOCKBOARD_FORM_HTML)
    const marker = doc.querySelectorAll('[data-platform="mockboard"]')[0]
    expect(marker?.getAttribute('data-platform-version')).toBe(MOCKBOARD_ADAPTER.version)
  })
})

describe('CI 冒烟（选择器不许在自家快照上扑空）', () => {
  it('每个选择器都解析到已知字段 —— 扑空即版本漂移', () => {
    for (const adapter of BUILTIN_PLATFORM_ADAPTERS) {
      const doc = parseHtmlFixture(SNAPSHOT_HTML[adapter.id] ?? '')
      const knownKeys = new Set(extractFieldFeatures(doc).map((f) => f.key))
      const bindings = adapterBindings(adapter, doc, knownKeys)
      const total = Object.keys(adapter.selectors).length
      expect(
        bindings.size,
        `${adapter.id}: ${bindings.size}/${total} 个选择器解析成功`,
      ).toBe(total)
    }
  })
})

/**
 * 逐字段 ground truth（TASKS T5.2「字段匹配率断言」的落地形式）。
 *
 * 不报百分比：每个 key 的最终归宿序列化成 `kind:path/value:source`
 * 字符串，与人工核对的期望做**对象级整体相等** —— 多填、少填、
 * 错配、source 标错，任何一种偏差都让整个对象对不上。
 */
function expectGroundTruth(
  html: string,
  expected: Readonly<Record<string, string>>,
): void {
  const plan = buildFillPlan(parseHtmlFixture(html), fillTestArchive())
  const actual: Record<string, string> = {}
  for (const item of plan.items) {
    if (item.kind === 'fill') {
      actual[item.key] = `fill:${item.path}:${item.value}:${item.source}`
    } else if (item.kind === 'gap') {
      actual[item.key] = `gap:${item.reason}:${item.blocking ? 'blocking' : 'optional'}`
    } else {
      actual[item.key] = `file-slot:${item.required ? 'required' : 'optional'}`
    }
  }
  expect(actual).toEqual(expected)
}

describe('逐字段 ground truth（北森 / Moka / 大易）', () => {
  it('北森：随机 id + span 标题 + placeholder 句式，适配器钉 4 个高危字段', () => {
    // 「姓名」与「姓名拼音」的 placeholder 都含「姓名」，纯启发式会
    // 打平成歧义 —— name.zh 必须由适配器钉住；「备用联系电话」同理。
    // 邮箱 / 自我介绍没有歧义对象，留给启发式（占位符包含命中 3 分）。
    expectGroundTruth(BEISEN_SNAPSHOT_HTML, {
      txt_8f3a2c1e: 'fill:basics.name.zh:张智远:adapter',
      txt_b2e7f0d3: 'fill:basics.contact.phone:13800138000:adapter',
      rdoGender: 'fill:basics.identity.gender:1:adapter',
      sel_5e2f8a9c: 'fill:education.0.studyType.zh:3:adapter',
      txt_c4d9e1b6: 'fill:basics.contact.email:zhang@example.com:heuristic',
      txt_e8b2c4d7: 'fill:basics.summary.zh:五年前端经验，主攻工程化与性能。:heuristic',
      txt_9c1d4b7a: 'gap:no-catalog-match:optional',
      txt_a6c5e8f2: 'gap:no-catalog-match:optional',
      txt_f1a9b3c8: 'gap:no-catalog-match:blocking',
      file_7d2c1b8e: 'file-slot:required',
    })
  })

  it('Moka：label 规范的站点启发式命中率本来就高，适配器只钉 3 个', () => {
    // email 字段 type=text（Moka 真实如此）—— 类型闸门放行 text。
    // 招聘渠道下拉在目录里没有词汇可对 —— no-catalog-match，不是档案的错。
    expectGroundTruth(MOKA_SNAPSHOT_HTML, {
      'field-a1b2c3': 'fill:basics.name.zh:张智远:adapter',
      'field-d4e5f6': 'fill:basics.contact.phone:13800138000:adapter',
      'field-g7h8i9': 'fill:basics.contact.email:zhang@example.com:adapter',
      'field-j1k2l3': 'fill:basics.contact.wechat:zhangzy_1988:heuristic',
      'field-m4n5o6': 'fill:basics.location.city:chengdu:heuristic',
      'field-p7q8r9': 'fill:education.0.studyType.zh:4:heuristic',
      'field-s1t2u3': 'fill:education.0.institution:电子科技大学:heuristic',
      'field-v4w5x6': 'fill:basics.desiredSalary.amount:25000:heuristic',
      'field-y7z8a9': 'fill:basics.summary.zh:五年前端经验，主攻工程化与性能。:heuristic',
      'field-b1c2d3': 'gap:no-catalog-match:optional',
      'field-e4f5g6': 'file-slot:required',
      'field-h7i8j9': 'file-slot:optional',
    })
  })

  it('大易：电话歧义由适配器解围；毕业时间只有年份下拉 → option-mismatch', () => {
    // 「紧急联系人电话」与「手机号码」对 phone 的包含得分打平（6 分），
    // 纯启发式会双双留成歧义 —— 适配器钉 p_mobile 是唯一解围方式。
    // 毕业时间下拉只有年份，档案是 2024-06 —— DESIGN 234 的术语缝，
    // 兜成 option-mismatch（blocking）而不是硬猜一个年份。
    expectGroundTruth(DAYEE_SNAPSHOT_HTML, {
      p_mobile: 'fill:basics.contact.phone:13800138000:adapter',
      p_education: 'fill:education.0.studyType.zh:本科:adapter',
      p_name: 'fill:basics.name.zh:张智远:heuristic',
      p_sex: 'fill:basics.identity.gender:0:heuristic',
      p_email: 'fill:basics.contact.email:zhang@example.com:heuristic',
      p_salary: 'fill:basics.desiredSalary.amount:25000:heuristic',
      p_intro: 'fill:basics.summary.zh:五年前端经验，主攻工程化与性能。:heuristic',
      p_contact_tel: 'gap:no-catalog-match:optional',
      p_graduate: 'gap:option-mismatch:blocking',
      p_note: 'gap:no-catalog-match:optional',
      p_resume: 'file-slot:required',
    })
  })
})
