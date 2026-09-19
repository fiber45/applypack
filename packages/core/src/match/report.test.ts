/**
 * `MatchReportView` 的断言 —— T2.3 在**零 DOM** 环境里的那一半。
 *
 * 分工写在 `report.ts` 的文件头，这里再钉一次，因为它是本文件每一段的结构依据：
 *
 *   - **本文件**验的是**算术与形状**：四项构成相加是否精确等于总分、
 *     判别联合是否真的排除了「淘汰但没解释」、零分维度是否还在。
 *     这些和 DOM 无关，所以它们**不该**需要 jsdom 才能跑。
 *   - `packages/web` 里验的是**渲染**：界面有没有把已经拿到的信息藏起来。
 *
 * 为什么非要这么分：把算术断言放进 DOM 测试，代价是它从此只能在浏览器环境里跑，
 * 而浏览器环境是这个仓库里最慢、最容易被 `skip` 掉的那一层。
 * 一个「能被 skip 掉的断言」等于没有断言。
 */

import { describe, expect, it } from 'vitest'

import type { CompiledJd } from '../compile/index'
import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import {
  buildReportView,
  DEFAULT_WEIGHTS,
  matchArchive,
  matchItems,
  type MatchWeights,
} from './index'
import { apportionToTenths, DIMENSION_HINT, DIMENSION_LABEL, REPORT_DIMENSIONS } from './report'
import type { MatchItem } from './types'

/**
 * 一份**故意把三种情形都凑齐**的输入：
 *   - `STRONG` 全命中技能、新鲜、有量化 → 高分入选
 *   - `WEAK`   只中一个技能、两年多以前   → 淘汰，有明确短板
 *   - `BARE`   一个要点都没有             → 淘汰，且量化率**恰好为 0**
 *
 * `BARE` 不是凑数用的。它是「四项构成恒为四项」那条断言唯一的抓手：
 * 只有当某一维度真能得 0 分时，「零分维度还在不在」才是个能红的问题。
 */
const JD: CompiledJd = {
  title: '算法工程师',
  company: null,
  hardRequirements: [],
  skills: [
    { name: 'Python', proficiency: 'proficient', required: true, evidence: '熟悉 Python' },
    { name: 'PyTorch', proficiency: 'expert', required: true, evidence: '精通 PyTorch' },
    { name: '推荐系统', proficiency: 'familiar', required: false, evidence: '有推荐系统经验者优先' },
  ],
  responsibilities: [],
  register: 'technical',
  language: 'zh',
}

const NOW = '2026-09'

const STRONG: MatchItem = {
  entryId: 'work.0',
  kind: 'work',
  title: '算法工程实习生',
  organization: '杭州某某科技',
  startDate: '2025-06',
  endDate: '2025-09',
  texts: [
    '算法工程实习生',
    '杭州某某科技',
    '负责推荐系统召回通道的特征工程',
    '累计上线 12 个特征',
    '使用 Python 与 PyTorch 建模',
  ],
  highlightCount: 2,
  quantifiedCount: 1,
}

const WEAK: MatchItem = {
  entryId: 'work.1',
  kind: 'work',
  title: '数据分析实习生',
  organization: '某某银行',
  startDate: '2022-07',
  endDate: '2022-09',
  texts: ['数据分析实习生', '某某银行', '用 Python 做业务报表'],
  highlightCount: 1,
  quantifiedCount: 0,
}

const BARE: MatchItem = {
  entryId: 'work.2',
  kind: 'work',
  title: '课程项目',
  organization: '',
  startDate: '2024-03',
  endDate: '2024-06',
  texts: ['课程项目'],
  highlightCount: 0,
  quantifiedCount: 0,
}

const ITEMS: readonly MatchItem[] = [STRONG, WEAK, BARE]

/** 1 条入选、2 条淘汰 —— 选中项与淘汰项同时在场，对称性才谈得上。 */
const MIXED = matchItems(ITEMS, JD, { now: NOW, limit: 1 })

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/** 到 0.1 的整数倍上再比：浮点和不能直接 `toBe`。 */
function tenthsOf(value: number): number {
  return Math.round(value * 10)
}

function compositionTotal(row: { composition: readonly { contribution: number }[] }): number {
  return sum(row.composition.map((item) => item.contribution))
}

describe('行与状态：形状由 MatchReport 决定，不由界面决定', () => {
  it('一行不多、一行不少，顺序就是 reports.scored 的顺序', () => {
    const view = buildReportView(MIXED)
    expect(view.rows.map((row) => row.entryId)).toEqual(
      MIXED.scored.map((entry) => entry.item.entryId),
    )
  })

  it('名次按分数降序连续编号，跨选中 / 淘汰不跳号', () => {
    const view = buildReportView(MIXED)
    expect(view.rows.map((row) => row.rank)).toEqual([1, 2, 3])
    // 排序本身也要对：名次 1 的分数不低于名次 2，以此类推。
    expect(view.rows[0]?.total).toBeGreaterThanOrEqual(view.rows[1]?.total ?? 0)
    expect(view.rows[1]?.total).toBeGreaterThanOrEqual(view.rows[2]?.total ?? 0)
  })

  it('状态与报告一致，且计数加起来就是总行数', () => {
    const view = buildReportView(MIXED)
    expect(view.rows.map((row) => row.status)).toEqual(
      MIXED.scored.map((entry) => (entry.selected ? 'selected' : 'rejected')),
    )
    expect(view.selectedCount + view.rejectedCount).toBe(view.rows.length)
    expect(view.selectedCount).toBe(MIXED.selected.length)
    expect(view.rejectedCount).toBe(MIXED.rejected.length)
  })

  it('入选线原样透传 —— 视图层不重算任何分数', () => {
    const view = buildReportView(MIXED)
    expect(view.cutoff).toBe(MIXED.cutoff)
    expect(view.dimensions).toEqual(REPORT_DIMENSIONS)
  })

  it('total 取自打分，不是把四项加起来重算的', () => {
    const view = buildReportView(MIXED)
    expect(view.rows.map((row) => row.total)).toEqual(
      MIXED.scored.map((entry) => entry.breakdown.total),
    )
  })
})

describe('分数构成恒为四项 —— 不许「只显示失分的那几项」', () => {
  it('选中项与淘汰项的构成条数完全相同', () => {
    const view = buildReportView(MIXED)
    const selected = view.rows.filter((row) => row.status === 'selected')
    const rejected = view.rows.filter((row) => row.status === 'rejected')
    expect(selected.length).toBeGreaterThan(0)
    expect(rejected.length).toBeGreaterThan(0)
    for (const row of view.rows) expect(row.composition).toHaveLength(REPORT_DIMENSIONS.length)
    // 这一句才是重点：**不是「都非空」，是「都等于四项」**。
    expect(new Set(view.rows.map((row) => row.composition.length))).toEqual(
      new Set([REPORT_DIMENSIONS.length]),
    )
  })

  it('四项的顺序恒等于 REPORT_DIMENSIONS —— 行序不随对象键序漂移', () => {
    const view = buildReportView(MIXED)
    for (const row of view.rows) {
      expect(row.composition.map((item) => item.dimension)).toEqual([...REPORT_DIMENSIONS])
    }
  })

  it('得 0 分的维度仍在，且显示 0 —— 「拿 0 分」与「没被检查」必须分得开', () => {
    const view = buildReportView(MIXED)
    const bare = view.rows.find((row) => row.entryId === 'work.2')
    expect(bare).toBeDefined()
    const quantification = bare?.composition.find((item) => item.dimension === 'quantification')
    expect(quantification?.raw).toBe(0)
    expect(quantification?.contribution).toBe(0)
    expect(quantification?.dimension).toBe('quantification')
  })

  it('四项都可能是「失分项」也可能是「满分项」，但每一项都有名字和说明', () => {
    const view = buildReportView(MIXED)
    for (const row of view.rows) {
      for (const item of row.composition) {
        expect(item.label).toBe(DIMENSION_LABEL[item.dimension])
        expect(item.hint).toBe(DIMENSION_HINT[item.dimension])
        expect(item.label.length).toBeGreaterThan(0)
        expect(item.hint.length).toBeGreaterThan(0)
        expect(item.raw).toBeGreaterThanOrEqual(0)
        expect(item.raw).toBeLessThanOrEqual(1)
      }
    }
  })

  it('判据不空转：真的存在 raw === 0 与 raw === 1 两种维度', () => {
    // 没有这一条，「raw 落在 [0,1]」只是把打分函数的取值范围抄了一遍 —— 恒真。
    const view = buildReportView(MIXED)
    const raws = view.rows.flatMap((row) => row.composition.map((item) => item.raw))
    expect(raws).toContain(0)
    expect(raws).toContain(1)
  })
})

describe('四项构成相加精确等于总分（T2.3 ③）', () => {
  it('每一行都成立', () => {
    const view = buildReportView(MIXED)
    for (const row of view.rows) {
      expect(tenthsOf(compositionTotal(row))).toBe(tenthsOf(row.total))
    }
  })

  it('选中的与淘汰的一样成立 —— 恒等式不挑状态', () => {
    const view = buildReportView(MIXED)
    expect(view.selectedCount).toBeGreaterThan(0)
    expect(view.rejectedCount).toBeGreaterThan(0)
    const statuses = new Set(view.rows.map((row) => row.status))
    expect(statuses).toEqual(new Set(['selected', 'rejected']))
    for (const row of view.rows) {
      expect(tenthsOf(compositionTotal(row))).toBe(tenthsOf(row.total))
    }
  })

  it('四项额度相加是 100 分 —— 构成覆盖了总分，没有第五项藏在别处', () => {
    const view = buildReportView(MIXED)
    for (const row of view.rows) {
      expect(sum(row.composition.map((item) => item.maxContribution))).toBeCloseTo(100, 9)
    }
  })

  it('最大余数法只挪动小于一个刻度，且恰好为 0 的项不动', () => {
    // 这两个断言合起来才说明它没有在替用户调分：上界管住幅度，下界管住「不填缝」。
    const view = buildReportView(MIXED)
    for (const row of view.rows) {
      for (const item of row.composition) {
        const exact = item.raw * item.maxContribution
        expect(Math.abs(item.contribution - exact)).toBeLessThan(0.1)
      }
    }
  })

  it('朴素四舍五入会算不平 —— 所以这个算法不是装饰', () => {
    // 一组四项各 4.05 分的构成：真值和 16.2，各自四舍五入得到 4.1 × 4 = 16.4。
    const values = [4.05, 4.05, 4.05, 4.05]
    const naive = values.map((value) => Math.round(value * 10) / 10)
    expect(tenthsOf(sum(naive))).not.toBe(tenthsOf(sum(values)))

    const apportioned = apportionToTenths(values, 16.2)
    expect(tenthsOf(sum(apportioned))).toBe(tenthsOf(16.2))
    // 挪动幅度仍在界内。
    apportioned.forEach((value, index) => {
      expect(Math.abs(value - (values[index] ?? 0))).toBeLessThan(0.1)
    })
  })

  it('恰好为 0 的项不参与凑数', () => {
    const apportioned = apportionToTenths([4.05, 4.05, 4.05, 0], 12.2)
    expect(apportioned[3]).toBe(0)
    expect(tenthsOf(sum(apportioned))).toBe(tenthsOf(12.2))
  })

  it('边界输入不炸也不撒谎', () => {
    expect(apportionToTenths([], 0)).toEqual([])
    expect(apportionToTenths([0], 0)).toEqual([0])
    expect(apportionToTenths([100], 100)).toEqual([100])
    // 浮点误差不该被当成「差了一分钱」而调走一格。
    expect(tenthsOf(sum(apportionToTenths([33.333, 33.333, 33.334], 100)))).toBe(1000)
  })
})

describe('权重取自报告本身，不是模块默认值', () => {
  const CUSTOM: MatchWeights = { keyword: 0.4, recency: 0.1, quantification: 0.2, depth: 0.3 }

  it('换成自定义权重后，四项额度跟着变', () => {
    const custom = matchItems(ITEMS, JD, { now: NOW, limit: 1, weights: CUSTOM })
    const view = buildReportView(custom)
    const maxes = view.rows[0]?.composition.map((item) => item.maxContribution) ?? []
    expect(maxes).toHaveLength(REPORT_DIMENSIONS.length)
    REPORT_DIMENSIONS.forEach((dimension, index) => {
      expect(maxes[index]).toBeCloseTo(CUSTOM[dimension] * 100, 9)
    })
    // 与默认权重下的额度不同 —— 否则上面那句可能只是抄了一遍默认值。
    expect(maxes).not.toEqual(
      REPORT_DIMENSIONS.map((dimension) => DEFAULT_WEIGHTS[dimension] * 100),
    )
  })

  it('自定义权重下恒等式照样成立 —— 换了权重也没让它算不平', () => {
    const custom = matchItems(ITEMS, JD, { now: NOW, limit: 1, weights: CUSTOM })
    const view = buildReportView(custom)
    for (const row of view.rows) {
      expect(tenthsOf(compositionTotal(row))).toBe(tenthsOf(row.total))
    }
    // 与默认权重下的分数不同 —— 否则上面两条可能只是碰巧。
    expect(view.rows.map((row) => row.total)).not.toEqual(
      buildReportView(MIXED).rows.map((row) => row.total),
    )
  })
})

describe('淘汰项与选中项同等可查（T2.3 ②）', () => {
  it('淘汰行的 rejection 必然有值，选中行必然是 null', () => {
    const view = buildReportView(MIXED)
    for (const row of view.rows) {
      if (row.status === 'rejected') {
        expect(row.rejection).not.toBeNull()
        expect(row.rejection.summary.length).toBeGreaterThan(0)
      } else {
        expect(row.rejection).toBeNull()
      }
    }
  })

  it('解释指向的就是这一行自己 —— 不是接错了的', () => {
    const view = buildReportView(MIXED)
    const rejected = view.rows.filter((row) => row.status === 'rejected')
    expect(rejected.length).toBeGreaterThan(0)
    expect(rejected.map((row) => row.rejection.entryId)).toEqual(
      rejected.map((row) => row.entryId),
    )
  })

  it('选中的那一行，构成与理由一样齐 —— 没有「入选就不用解释了」这回事', () => {
    const view = buildReportView(MIXED)
    const selected = view.rows.find((row) => row.status === 'selected')
    const rejected = view.rows.find((row) => row.status === 'rejected')
    expect(selected).toBeDefined()
    expect(rejected).toBeDefined()
    // 两边都有构成、都有理由数组（理由可以是空数组，但不能是 undefined）。
    expect(Array.isArray(selected?.composition)).toBe(true)
    expect(Array.isArray(rejected?.composition)).toBe(true)
    expect(Array.isArray(selected?.reasons)).toBe(true)
    expect(Array.isArray(rejected?.reasons)).toBe(true)
  })

  it('「淘汰了但没解释」不可表达 —— 类型层面被排除，不是靠自觉', () => {
    const view = buildReportView(MIXED)
    let visitedRejected = 0
    let visitedSelected = 0

    for (const row of view.rows) {
      if (row.status === 'rejected') {
        visitedRejected += 1
        // @ts-expect-error 判别联合：status 为 'rejected' 时 rejection 不可能是 null。
        const impossible: null = row.rejection
        // 运行时它就是解释对象本身；上面那个类型注解的作用是让这一行**必须**编译失败，
        // 也就是把「淘汰但没解释」从可表达状态里删掉。
        expect(impossible).toBe(row.rejection)
      } else {
        visitedSelected += 1
        const possible: null = row.rejection
        expect(possible).toBeNull()
      }
    }

    // 两个分支都得跑到 —— 否则上面那个 `@ts-expect-error` 只是编译期的死代码，
    // 而「断言只在编译期生效」时，一次类型放宽就会让它无声失效。
    expect(visitedRejected).toBeGreaterThan(0)
    expect(visitedSelected).toBeGreaterThan(0)
  })

  it('极端档位下形状不变：全部淘汰、全部入选', () => {
    const none = buildReportView(matchItems(ITEMS, JD, { now: NOW, limit: 0 }))
    expect(none.selectedCount).toBe(0)
    expect(none.rejectedCount).toBe(ITEMS.length)
    expect(none.rows.every((row) => row.status === 'rejected')).toBe(true)
    expect(none.rows.every((row) => row.rejection !== null)).toBe(true)

    const all = buildReportView(matchItems(ITEMS, JD, { now: NOW, limit: 99 }))
    expect(all.rejectedCount).toBe(0)
    expect(all.rows.every((row) => row.status === 'selected')).toBe(true)
    expect(all.rows.every((row) => row.composition.length === REPORT_DIMENSIONS.length)).toBe(true)
  })
})

describe('视图层与模型层的关系', () => {
  it('是纯函数：同一份报告两次摊平的结果深相等', () => {
    expect(buildReportView(MIXED)).toEqual(buildReportView(MIXED))
  })

  it('返回普通对象而非 Promise —— 没有出网的可能', () => {
    const view = buildReportView(MIXED)
    expect(view).not.toBeInstanceOf(Promise)
    expect(typeof (view as unknown as { then?: unknown }).then).toBe('undefined')
  })

  it('手搓一份「淘汰项没解释」的报告会报错，而不是少渲染一块', () => {
    // 到不了这个分支的正常路径已由上面几条守着；这里守的是**绕过正常路径**的那种改法。
    // 不写这条断言的话，`throw` 那句代码就是一段没人跑过的死代码，
    // 而它本来的用途恰恰是「万一有人手搓报告时不要静默」—— 死代码守不住任何东西。
    const contradictory = {
      ...MIXED,
      scored: [
        ...MIXED.selected.map((entry) => ({ ...entry, selected: false, rejection: null })),
        ...MIXED.rejected,
      ],
    }
    expect(() => buildReportView(contradictory)).toThrow(/没有解释/)
  })

  it('整条链路：档案直接进，界面可用的行直接出', () => {
    const view = buildReportView(matchArchive(maximalArchiveV1, JD, { now: NOW, limit: 2 }))
    expect(view.rows).toHaveLength(5)
    expect(view.selectedCount).toBe(2)
    expect(view.rejectedCount).toBe(3)
    for (const row of view.rows) {
      expect(tenthsOf(compositionTotal(row))).toBe(tenthsOf(row.total))
    }
  })
})
