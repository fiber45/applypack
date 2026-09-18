import { describe, expect, it } from 'vitest'

import { compareNumeric, untraceableNumbers } from './numbers'
import { multiViewParity, textsParity } from './parity'

const ZH = [
  '负责推荐系统召回通道的特征工程，累计上线 12 个特征，将离线特征回填耗时从 4.2 小时降至 38 分钟。',
]

describe('跨语言数字一致性', () => {
  it('措辞完全不同但数字集合相同 → 一致', () => {
    const report = textsParity(ZH, [
      'Rebuilt the recall feature pipeline, shipping 12 features and cutting offline backfill from 4.2 hours to 38 minutes.',
    ])
    expect(report.ok).toBe(true)
    expect(report.onlyInLeft).toEqual([])
    expect(report.onlyInRight).toEqual([])
  })

  it('把「4.2 小时 → 38 分钟」换算成 91% → 判为不一致', () => {
    const report = textsParity(ZH, ['Cut offline backfill turnaround by 91%, shipping 12 features'])
    expect(report.ok).toBe(false)
    expect(report.onlyInLeft).toEqual(['4.2', '38'])
    expect(report.onlyInRight).toEqual(['91'])
  })

  it('千分位是写法差异，不是事实差异（3000 === 3,000）', () => {
    expect(textsParity(['服务 3000 名用户'], ['serving 3,000 users']).ok).toBe(true)
  })

  it('一个逗号的位置就能让两份简历讲两个规模', () => {
    const report = textsParity(['服务 3000 名用户'], ['serving 30,000 users'])
    expect(report.ok).toBe(false)
    expect(report.onlyInLeft).toEqual(['3000'])
    expect(report.onlyInRight).toEqual(['30000'])
  })

  it('数字列表按数值排序 —— 与 untraceableNumbers 同一套顺序', () => {
    const report = textsParity(['a 4.2 b 38 c 12'], [])
    expect(report.onlyInLeft).toEqual(['4.2', '12', '38'])
    // 同一个界面上的两个数字列表用两种顺序，用户会以为是两回事
    expect([...report.onlyInLeft]).toEqual(['38', '4.2', '12'].slice().sort(compareNumeric))
    expect(untraceableNumbers('38 4.2 12', []).length).toBe(3)
  })
})

describe('多视图两两一致', () => {
  const views = [
    { name: 'zh', texts: ZH },
    { name: 'en', texts: ['12 features shipped, from 4.2 hours to 38 minutes'] },
    { name: 'bilingual', texts: ['12 features / 4.2 hours / 38 minutes'] },
  ]

  it('三版一致时 ok，且不带出任何一对', () => {
    const report = multiViewParity(views)
    expect(report.ok).toBe(true)
    expect(report.pair).toBeNull()
  })

  it('不一致时只报**第一处**涉及的视图对，而不是全部组合', () => {
    const broken = [
      views[0]!,
      { name: 'en', texts: ['cut turnaround by 91%'] },
      { name: 'bilingual', texts: ['cut turnaround by 91%'] },
    ]
    const report = multiViewParity(broken)
    expect(report.ok).toBe(false)
    // zh↔en 与 zh↔bilingual 是同一个毛病；报两条会让人以为有两个问题
    expect(report.pair).toEqual(['zh', 'en'])
    expect(report.onlyInLeft).toEqual(['4.2', '12', '38'])
    expect(report.onlyInRight).toEqual(['91'])
  })

  it('视图少于两个时平凡成立', () => {
    expect(multiViewParity([views[0]!]).ok).toBe(true)
    expect(multiViewParity([]).ok).toBe(true)
  })
})
