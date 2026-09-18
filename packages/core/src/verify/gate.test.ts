import { describe, expect, it } from 'vitest'

import type { CompiledJd } from '../compile/index'
import { FATAL_REASONS, verifyBullets, verifyFacts, type Bullet, type FailureReason } from './gate'

const SOURCES: readonly string[] = [
  '负责召回通道的特征工程，累计上线 12 个特征，回填耗时从 4.2 小时降至 38 分钟。',
  '主导推荐系统的召回链路改造。',
]

const JD: CompiledJd = {
  title: '算法工程师',
  company: null,
  hardRequirements: [],
  responsibilities: [],
  skills: [
    { name: '推荐系统', proficiency: 'proficient', required: true, evidence: '推荐系统' },
    { name: '特征工程', proficiency: 'proficient', required: true, evidence: '特征工程' },
    { name: 'PyTorch', proficiency: 'familiar', required: false, evidence: 'PyTorch' },
  ],
  register: 'technical',
  language: 'zh',
}

/** 一条在各维度都干净的 bullet，用作各项对照的基线。它对 JD 的覆盖是 2/3，达标。 */
const CLEAN: Bullet = {
  id: 'b1',
  text: '负责推荐系统的特征工程，上线 12 个特征',
}

/** 只命中 3 个 JD 技能中的 1 个（33%），用来触发覆盖面不足。 */
const PARTIAL: Bullet = {
  id: 'b3',
  text: '负责特征工程的数据清洗与校验',
}

function reasonsOf(result: { failures: readonly { reason: FailureReason }[] }): FailureReason[] {
  return result.failures.map((failure) => failure.reason)
}

describe('T3.2 · 数字溯源（一票否决）', () => {
  it('注入虚构数字 ⇒ pass: false，reason 为 number_not_in_source 且带 offending', () => {
    const result = verifyFacts([{ id: 'b7', text: '负责特征工程，提升 40% 效率' }], SOURCES)

    expect(result.pass).toBe(false)
    const failure = result.failures.find((item) => item.reason === 'number_not_in_source')
    expect(failure).toBeDefined()
    expect(failure?.offending).toBe('40')
    expect(failure?.bulletId).toBe('b7')
    expect(failure?.severity).toBe('fatal')
  })

  it('数字全部来自原文 ⇒ 通过', () => {
    expect(verifyFacts([CLEAN], SOURCES).pass).toBe(true)
  })

  it('把 12 改成 120 ⇒ 仍然抓得住（改写数字也算编造）', () => {
    const result = verifyFacts([{ id: 'b1', text: '负责特征工程，上线 120 个特征' }], SOURCES)
    expect(result.failures.map((failure) => failure.offending)).toContain('120')
  })

  it('4.2 被写成 4 ⇒ 判为编造（那是另一个数，不是写法差异）', () => {
    const result = verifyFacts([{ id: 'b1', text: '负责优化，耗时降至 4 小时' }], SOURCES)
    expect(result.failures.map((failure) => failure.offending)).toContain('4')
  })

  it('**能被单独测**：verifyFacts 只返回一票否决项，不受其它指标干扰', () => {
    // 这条稿子在动词、长度、量化率上全都不达标，但 verifyFacts 只关心数字。
    const messy: Bullet = { id: 'b9', text: '参与了相关工作并被指派处理事务' }
    const result = verifyFacts([messy], SOURCES)
    expect(result.pass).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('FATAL_REASONS 是封闭且非空的集合', () => {
    expect(FATAL_REASONS).toEqual(['number_not_in_source'])
  })

  it('一票否决项不受「其它指标全绿」影响 —— 一票就是一票', () => {
    const result = verifyBullets({
      bullets: [{ id: 'b1', text: '负责推荐系统的特征工程与 PyTorch 建模，提升 40%' }],
      sources: SOURCES,
      jd: JD,
    })
    expect(result.failures.filter((failure) => failure.severity === 'fatal')).toHaveLength(1)
    expect(result.pass).toBe(false)
  })
})

describe('T3.2 · 强动词开头', () => {
  it('弱短语开头 ⇒ weak_verb_opening，offending 是那个词本身', () => {
    const result = verifyBullets({ bullets: [{ id: 'b1', text: '参与了推荐系统的开发' }], sources: SOURCES })
    const failure = result.failures.find((item) => item.reason === 'weak_verb_opening')
    expect(failure?.offending).toBe('参与')
  })

  it('英文弱开头同样被识别', () => {
    const result = verifyBullets({
      bullets: [{ id: 'b1', text: 'Responsible for feature engineering' }],
      sources: SOURCES,
    })
    expect(reasonsOf(result)).toContain('weak_verb_opening')
  })

  it('开头不是强动词 ⇒ 也报，并指出实际的开头', () => {
    const result = verifyBullets({ bullets: [{ id: 'b1', text: '累计上线 12 个特征' }], sources: SOURCES })
    const failure = result.failures.find((item) => item.reason === 'weak_verb_opening')
    expect(failure?.offending).toBe('累计')
    expect(failure?.detail).toContain('累计')
  })

  it('同一条只报一次 —— 弱开头不再重复报「不在强动词表里」', () => {
    const result = verifyBullets({ bullets: [{ id: 'b1', text: '协助推荐系统的开发' }], sources: SOURCES })
    const openings = result.failures.filter((item) => item.reason === 'weak_verb_opening')
    expect(openings).toHaveLength(1)
  })

  it('强动词开头通过（中文与英文）', () => {
    const result = verifyBullets({
      bullets: [
        { id: 'b1', text: '负责推荐系统的特征工程' },
        { id: 'b2', text: 'Led the recommender system rewrite' },
      ],
      sources: SOURCES,
    })
    expect(reasonsOf(result)).not.toContain('weak_verb_opening')
  })
})

describe('T3.2 · 被动语态', () => {
  it('中文被动被识别', () => {
    const result = verifyBullets({ bullets: [{ id: 'b1', text: '负责的特征工程被整体重构' }], sources: SOURCES })
    expect(reasonsOf(result)).toContain('passive_voice')
  })

  it('英文被动被识别', () => {
    const result = verifyBullets({
      bullets: [{ id: 'b1', text: 'Led the pipeline that was optimized last year' }],
      sources: SOURCES,
    })
    expect(reasonsOf(result)).toContain('passive_voice')
  })

  it('「被动」这个词本身不算被动语态', () => {
    const result = verifyBullets({
      bullets: [{ id: 'b1', text: '负责主动与被动召回策略的对比实验' }],
      sources: SOURCES,
    })
    expect(reasonsOf(result)).not.toContain('passive_voice')
  })
})

describe('T3.2 · 长度上限', () => {
  it('中文超过 45 字 ⇒ too_long', () => {
    const long = `负责${'召回通道特征工程与离线回填链路的优化改造工作'.repeat(2)}`
    expect(long.length).toBeGreaterThan(45)
    const result = verifyBullets({ bullets: [{ id: 'b1', text: long }], sources: SOURCES })
    expect(reasonsOf(result)).toContain('too_long')
  })

  it('英文超过 25 词 ⇒ too_long（词数与中文字数分开计数）', () => {
    const long =
      'Led the design and implementation of a large scale feature engineering pipeline that reduced offline backfill latency across multiple teams regions products and significantly improved overall system performance metrics'
    expect(long.split(' ').length).toBeGreaterThan(25)
    const result = verifyBullets({ bullets: [{ id: 'b1', text: long }], sources: SOURCES })
    expect(reasonsOf(result)).toContain('too_long')
  })

  it('阈值可注入 —— 上限是配置，不是硬编码', () => {
    const text = '负责推荐系统的特征工程与离线回填链路优化改造工作'
    const strict = verifyBullets({
      bullets: [{ id: 'b1', text }],
      sources: SOURCES,
      thresholds: { maxChars: 10 },
    })
    expect(reasonsOf(strict)).toContain('too_long')
  })
})

describe('T3.2 · 动词重复', () => {
  const bullets: Bullet[] = [
    { id: 'b1', text: '负责召回链路改造' },
    { id: 'b2', text: '负责特征工程开发' },
    { id: 'b3', text: '负责回填链路优化' },
  ]

  it('同一开头动词出现超过上限 ⇒ 只报超出的那几条', () => {
    const result = verifyBullets({ bullets, sources: SOURCES })
    const repeats = result.failures.filter((item) => item.reason === 'verb_repetition')
    expect(repeats).toHaveLength(1)
    expect(repeats[0]?.bulletId).toBe('b3')
    expect(repeats[0]?.offending).toBe('负责')
  })

  it('上限之内不报', () => {
    const result = verifyBullets({ bullets: bullets.slice(0, 2), sources: SOURCES })
    expect(reasonsOf(result)).not.toContain('verb_repetition')
  })

  it('metrics 里带着最大重复次数，供 Agent 判断还有多少优化空间', () => {
    expect(verifyBullets({ bullets, sources: SOURCES }).metrics.maxVerbRepeat).toBe(3)
  })
})

describe('T3.2 · 优化目标（不阻断，但可见）', () => {
  it('量化率低于 70% ⇒ 报 low_quantification，但 severity 是 target', () => {
    const bullets: Bullet[] = [
      { id: 'b1', text: '负责召回链路改造' },
      { id: 'b2', text: '负责特征工程开发' },
    ]
    const result = verifyBullets({ bullets, sources: SOURCES })
    const failure = result.failures.find((item) => item.reason === 'low_quantification')
    expect(failure?.severity).toBe('target')
    expect(result.metrics.quantificationRate).toBe(0)
  })

  it('关键词覆盖低于 60% ⇒ 报 low_keyword_coverage，并点出缺哪些', () => {
    const result = verifyBullets({ bullets: [PARTIAL], sources: SOURCES, jd: JD })
    const failure = result.failures.find((item) => item.reason === 'low_keyword_coverage')
    expect(failure?.severity).toBe('target')
    expect(failure?.offending).toContain('PyTorch')
    expect(result.metrics.keywordCoverage).toBeCloseTo(1 / 3, 2)
  })

  it('覆盖 2/3 达标时不报 —— 阈值是 60%，不是「全中」', () => {
    const result = verifyBullets({ bullets: [CLEAN], sources: SOURCES, jd: JD })
    expect(reasonsOf(result)).not.toContain('low_keyword_coverage')
    expect(result.metrics.keywordCoverage).toBeCloseTo(2 / 3, 2)
  })

  it('**优化目标未达标不算失败** —— 闸门管的是有没有撒谎，不是写得好不好', () => {
    const result = verifyBullets({ bullets: [PARTIAL], sources: SOURCES, jd: JD })
    expect(result.failures.length).toBeGreaterThan(0)
    expect(result.failures.every((failure) => failure.severity === 'target')).toBe(true)
    expect(result.pass).toBe(true)
  })

  it('没有 JD 时不做关键词判定，覆盖率记为 1', () => {
    const result = verifyBullets({ bullets: [CLEAN], sources: SOURCES })
    expect(result.metrics.keywordCoverage).toBe(1)
    expect(reasonsOf(result)).not.toContain('low_keyword_coverage')
  })
})

describe('T3.2 · 闸门本身的性质', () => {
  it('纯函数：同输入同输出', () => {
    const input = { bullets: [CLEAN], sources: SOURCES, jd: JD }
    expect(verifyBullets(input)).toEqual(verifyBullets(input))
  })

  it('空输入不抛错', () => {
    const result = verifyBullets({ bullets: [], sources: [] })
    expect(result.pass).toBe(true)
    expect(result.metrics.bulletCount).toBe(0)
  })

  it('每条失败都带 offending 与可读 detail —— 模糊评价修不动东西', () => {
    const result = verifyBullets({
      bullets: [{ id: 'b1', text: '参与了相关工作被指派处理，提升 40%' }],
      sources: SOURCES,
      jd: JD,
    })
    expect(result.failures.length).toBeGreaterThan(2)
    for (const failure of result.failures) {
      expect(failure.offending).not.toBe('')
      expect(failure.detail.length).toBeGreaterThan(0)
    }
  })
})
