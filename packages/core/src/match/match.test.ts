import { describe, expect, it } from 'vitest'

import type { CompiledJd } from '../compile/index'
import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import * as match from './index'
import { DEFAULT_WEIGHTS, matchArchive, matchItems, scoreItem, type MatchWeights } from './index'
import type { MatchItem } from './types'

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

/** 全命中、新鲜、部分量化。 */
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

/** 只命中一个技能，且时间久远。 */
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

describe('匹配打分', () => {
  it('命中更多技能、更新、更量化的条目得分更高', () => {
    const strong = scoreItem(STRONG, JD, NOW)
    const weak = scoreItem(WEAK, JD, NOW)
    expect(strong.total).toBeGreaterThan(weak.total)
  })

  it('同输入同输出 —— 打分不读系统时间与随机数', () => {
    expect(scoreItem(STRONG, JD, NOW)).toEqual(scoreItem(STRONG, JD, NOW))
    expect(matchItems([STRONG, WEAK], JD, { now: NOW })).toEqual(
      matchItems([STRONG, WEAK], JD, { now: NOW }),
    )
  })

  it('时间参照来自参数而非系统时钟：换个 now 结果必须变', () => {
    const fresh = scoreItem(STRONG, JD, '2025-10')
    const stale = scoreItem(STRONG, JD, '2035-10')
    expect(fresh.total).toBeGreaterThan(stale.total)
  })

  it('关键词按必备 / 程度加权 —— 必备且要求精通的权重最高', () => {
    const torch = JD.skills.find((skill) => skill.name === 'PyTorch')
    const recommender = JD.skills.find((skill) => skill.name === '推荐系统')
    expect(torch).toBeDefined()
    expect(recommender).toBeDefined()
    if (torch !== undefined && recommender !== undefined) {
      expect(match.skillWeight(torch)).toBeGreaterThan(match.skillWeight(recommender))
    }
  })

  it('JD 没有任何技能时 keyword 维度不惩罚全体条目', () => {
    const noSkills: CompiledJd = { ...JD, skills: [] }
    expect(scoreItem(STRONG, noSkills, NOW).keyword).toBe(1)
  })

  it('默认权重之和为 1', () => {
    const sum =
      DEFAULT_WEIGHTS.keyword +
      DEFAULT_WEIGHTS.recency +
      DEFAULT_WEIGHTS.quantification +
      DEFAULT_WEIGHTS.depth
    expect(sum).toBeCloseTo(1, 10)
  })

  it('没有日期时给保守的中性值，而不是判成最差', () => {
    const undated: MatchItem = { ...STRONG, startDate: null, endDate: null }
    const breakdown = scoreItem(undated, JD, NOW)
    expect(breakdown.recency).toBeGreaterThan(0)
    expect(breakdown.recency).toBeLessThan(1)
  })
})

describe('理由与分数构成', () => {
  const reasons = match
    .matchItems([WEAK], JD, { now: NOW })
    .scored[0]?.reasons ?? []

  it('每个未命中的技能都有一条独立的负向理由', () => {
    const missed = reasons.filter((reason) => reason.kind === 'keyword_missed')
    expect(missed.map((reason) => reason.label).join(' ')).toContain('PyTorch')
    expect(missed.map((reason) => reason.label).join(' ')).toContain('推荐系统')
    expect(missed.every((reason) => reason.impact < 0)).toBe(true)
  })

  it('命中的技能也有条目，但 impact 为 0（「没失分」不等于「加了 0 分」）', () => {
    const hit = reasons.filter((reason) => reason.kind === 'keyword_hit')
    expect(hit.map((reason) => reason.label).join(' ')).toContain('Python')
    expect(hit.every((reason) => reason.impact === 0)).toBe(true)
  })

  it('理由按影响幅度降序 —— 最该看的排最前', () => {
    const magnitudes = reasons.map((reason) => Math.abs(reason.impact))
    const sorted = [...magnitudes].sort((a, b) => b - a)
    expect(magnitudes).toEqual(sorted)
  })

  it('**全部 impact 之和 ≈ 总分 - 100**（用户可自行核对的恒等式）', () => {
    for (const item of [STRONG, WEAK]) {
      const single = matchItems([item], JD, { now: NOW }).scored[0]
      expect(single).toBeDefined()
      if (single === undefined) continue
      const sum = single.reasons.reduce((acc, reason) => acc + reason.impact, 0)
      expect(Math.abs(sum - (single.breakdown.total - 100))).toBeLessThan(0.6)
    }
  })

  it('每条理由都带一句可直接展示给人看的 label', () => {
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.every((reason) => reason.label.trim().length > 0)).toBe(true)
  })
})

describe('淘汰解释 —— 「为什么删了我这段实习」', () => {
  const report = matchItems([STRONG, WEAK], JD, { now: NOW, limit: 1 })

  it('入选与淘汰按 limit 划分', () => {
    expect(report.selected).toHaveLength(1)
    expect(report.rejected).toHaveLength(1)
    expect(report.selected[0]?.item.entryId).toBe('work.0')
    expect(report.rejected[0]?.item.entryId).toBe('work.1')
  })

  it('淘汰项与选中项同等可查 —— 两者都在 scored 里', () => {
    expect(report.scored).toHaveLength(2)
    expect(report.scored.every((entry) => entry.reasons.length > 0)).toBe(true)
  })

  it('入选线是被淘汰者能看到的对照基准', () => {
    expect(report.cutoff).toBe(report.selected[0]?.breakdown.total)
    expect(report.rejected[0]?.breakdown.total).toBeLessThanOrEqual(report.cutoff)
  })

  it('解释指出了最主要的失分项，而不是泛泛而谈', () => {
    const explanation = report.explanations[0]
    expect(explanation).toBeDefined()
    expect(explanation?.blockingReason).not.toBeNull()
    expect(explanation?.blockingReason?.impact).toBeLessThan(0)
  })

  it('一句话 summary 能被直接读出来', () => {
    const summary = report.explanations[0]?.summary ?? ''
    expect(summary).toContain('某某银行')
    expect(summary).toContain('数据分析实习生')
    expect(summary).toContain('未入选')
    expect(summary).toContain(String(report.cutoff))
  })

  it('summary 点名了具体缺什么 —— 用户据此知道该补什么', () => {
    const summary = report.explanations[0]?.summary ?? ''
    expect(summary).toMatch(/PyTorch|推荐系统/)
  })

  it('解释了「被谁挤掉」', () => {
    const explanation = report.explanations[0]
    expect(explanation?.overtakenBy.length).toBeGreaterThan(0)
    expect(explanation?.overtakenBy[0]?.entryId).toBe('work.0')
  })

  it('limit 大于条目数时全部入选，没有淘汰解释', () => {
    const all = matchItems([STRONG, WEAK], JD, { now: NOW, limit: 10 })
    expect(all.rejected).toEqual([])
    expect(all.explanations).toEqual([])
  })

  it('入选线恒为「入选者的最低分」，与有没有人被拦下无关', () => {
    // 初稿的实现注释写「全部入选时为 0」，与实现不符。保留下来的是实现那一边：
    // cutoff 若随「有没有淘汰」改变含义，读的人就得先判断场景才能解释这个数。
    const all = matchItems([STRONG, WEAK], JD, { now: NOW, limit: 10 })
    expect(all.cutoff).toBe(all.selected.at(-1)?.breakdown.total)

    const none = matchItems([STRONG, WEAK], JD, { now: NOW, limit: 0 })
    expect(none.cutoff).toBe(0)
  })

  it('limit = 0 时全部淘汰，且每条都有解释', () => {
    const none = matchItems([STRONG, WEAK], JD, { now: NOW, limit: 0 })
    expect(none.selected).toEqual([])
    expect(none.explanations).toHaveLength(2)
  })

  it('同分时保持原始顺序（结果可复现）', () => {
    const twin: MatchItem = { ...WEAK, entryId: 'work.2', organization: '另一家银行' }
    const report2 = matchItems([WEAK, twin], JD, { now: NOW, limit: 0 })
    expect(report2.rejected.map((entry) => entry.item.entryId)).toEqual(['work.1', 'work.2'])
  })
})

describe('匹配层与模型的关系', () => {
  it('是同输入同输出（不是 Promise）—— 没有出网的可能', () => {
    const report = matchItems([STRONG], JD, { now: NOW })
    expect(report).not.toBeInstanceOf(Promise)
    expect(typeof (report as unknown as { then?: unknown }).then).toBe('undefined')
  })

  it('导出面里没有任何出网或客户端入口', () => {
    const names = Object.keys(match)
    expect(names).not.toContain('callLLM')
    expect(names).not.toContain('assembleLLMRequest')
    expect(names.filter((name) => /client|llm|egress/i.test(name))).toEqual([])
  })

  it('导出面封闭：新增导出要先改这一行', () => {
    expect(Object.keys(match).sort()).toEqual([
      'DEFAULT_LIMIT',
      'DEFAULT_WEIGHTS',
      'DIMENSION_HINT',
      'DIMENSION_LABEL',
      'REPORT_DIMENSIONS',
      'apportionToTenths',
      'buildReportView',
      'explainRejection',
      'extractMatchItems',
      'labelOf',
      'matchArchive',
      'matchItems',
      'scoreItem',
      'skillWeight',
    ])
  })
})

describe('从档案抽取条目', () => {
  it('抽出的条目只含 A 级内容 —— B 级字段不进匹配层', () => {
    const items = match.extractMatchItems(maximalArchiveV1)
    const dump = JSON.stringify(items)
    expect(dump).not.toContain(maximalArchiveV1.basics.contact.phone)
    expect(dump).not.toContain(maximalArchiveV1.basics.name.zh)
    expect(dump).not.toContain(maximalArchiveV1.basics.identity.idNumber)
    expect(dump).not.toContain(maximalArchiveV1.basics.location.address)
  })

  it('条目定位符可直接指回档案位置', () => {
    const items = match.extractMatchItems(maximalArchiveV1)
    expect(items.map((item) => item.entryId)).toEqual([
      'work.0',
      'projects.0',
      'education.0',
      'awards.0',
      'certificates.0',
    ])
  })

  it('i18n 字段的两个语种都参与匹配', () => {
    const items = match.extractMatchItems(maximalArchiveV1)
    const work = items[0]
    expect(work?.texts).toContain('算法工程实习生')
    expect(work?.texts).toContain('Algorithm Engineering Intern')
  })

  it('量化条数按要点里有没有数字来数', () => {
    const items = match.extractMatchItems(maximalArchiveV1)
    expect(items[0]?.highlightCount).toBe(2)
    expect(items[0]?.quantifiedCount).toBe(2)
  })

  it('整条链路可用：matchArchive 直接吃档案', () => {
    const report = matchArchive(maximalArchiveV1, JD, { now: NOW, limit: 2 })
    expect(report.scored).toHaveLength(5)
    expect(report.selected).toHaveLength(2)
    expect(report.explanations).toHaveLength(3)
  })
})

describe('淘汰解释挂在条目上，不是另开一张表（T2.3 ①）', () => {
  const report = matchArchive(maximalArchiveV1, JD, { now: NOW, limit: 2 })

  it('选中项的 rejection 是 null，淘汰项的必然有值', () => {
    expect(report.selected.every((entry) => entry.rejection === null)).toBe(true)
    expect(report.rejected.every((entry) => entry.rejection !== null)).toBe(true)
  })

  it('便利数组 explanations 恒等于 rejected 的投影 —— 不是第二份真相', () => {
    // 这条断言的作用是**让平行数组不可能漂移**。没有它，同一个结果有两处存放，
    // 改动一处另一处不变时没有任何症状（而这正是首版把解释放平行数组的代价）。
    expect(report.explanations).toEqual(report.rejected.map((entry) => entry.rejection))
    expect(report.explanations).toHaveLength(report.rejected.length)
  })

  it('遍历 scored 就能拿到全部解释，不需要任何 id 查找', () => {
    // 这条断言在说的事很具体：**「同等可查」不再依赖消费方记得 join。**
    // 首版要写 `report.explanations.find((item) => item.entryId === entry.item.entryId)`
    // 才能从一条淘汰项拿到它的解释 —— 一次 find 的失败是静默的（返回 undefined）。
    const fromScored = report.scored
      .filter((entry) => !entry.selected)
      .map((entry) => entry.rejection?.summary)
    expect(fromScored).toEqual(report.explanations.map((explanation) => explanation.summary))
    expect(fromScored.every((summary) => typeof summary === 'string')).toBe(true)
  })

  it('报告自带本次打分用的权重 —— 否则分数构成无法计算', () => {
    expect(report.weights).toBe(DEFAULT_WEIGHTS)

    const custom: MatchWeights = { keyword: 0.4, recency: 0.1, quantification: 0.2, depth: 0.3 }
    expect(matchItems([STRONG], JD, { now: NOW, weights: custom }).weights).toBe(custom)
  })
})
