/**
 * TASKS.md T3.1 的两条硬要求，这里各有一组可失败的断言：
 *
 *   - 「40 条并发：总延迟 ≈ 最慢一条」 → 峰值并发 + 墙钟时间上界
 *   - 「单条失败只重试该条」           → 逐条的调用次数
 *
 * 时间断言刻意用「串行基线的二分之一」而不是一个绝对的毫秒数：
 * 绝对数字会随机器负载漂移，而「比串行快一倍以上」是布局性质决定的，
 * 换机器、换 CI 都成立。并发峰值则是完全确定的量，不受调度影响。
 */

import { describe, expect, it } from 'vitest'

import { candidate, GOOD_TEXT, JD, mockClient, output } from './__fixtures__/harness'
import { rewriteBullets } from './rewrite'

const FABRICATED = '重构推荐系统召回链路，将回填耗时降低 40%'

/** 单条基准延迟（毫秒）与「最慢一条」的延迟。 */
const BASE_DELAY = 40
const SLOW_DELAY = 120
const SLOW_ID = 'b07'

function fortyCandidates(): ReturnType<typeof candidate>[] {
  return Array.from({ length: 40 }, (_, index) => candidate(`b${String(index).padStart(2, '0')}`))
}

describe('并发：全量同时发起', () => {
  it('40 条的峰值并发就是 40，不是「接近 40」', async () => {
    const candidates = fortyCandidates()
    const harness = mockClient(() => output(GOOD_TEXT), {
      delayFor: (id) => (id === SLOW_ID ? SLOW_DELAY : BASE_DELAY),
    })

    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: JD,
    })

    expect(report.concurrencyPeak).toBe(40)
    expect(report.rewritten).toHaveLength(40)
  })

  it('总延迟 ≈ 最慢一条，明显快于串行', async () => {
    const candidates = fortyCandidates()
    const harness = mockClient(() => output(GOOD_TEXT), {
      delayFor: (id) => (id === SLOW_ID ? SLOW_DELAY : BASE_DELAY),
    })

    const started = Date.now()
    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: JD,
    })
    const elapsed = Date.now() - started

    // 串行实现至少要花：39 × 40ms + 120ms
    const serialBaseline = 39 * BASE_DELAY + SLOW_DELAY
    expect(elapsed).toBeLessThan(serialBaseline / 2)
    // 但也不能快过最慢的那一条 —— 快了说明有请求没真的发出去
    expect(elapsed).toBeGreaterThanOrEqual(SLOW_DELAY)
    expect(report.calls).toBe(40)
  })
})

describe('失败隔离', () => {
  it('一条反复失败：只有它被重试，其余各调用一次', async () => {
    const candidates = fortyCandidates()
    const harness = mockClient((id) => (id === SLOW_ID ? output(FABRICATED) : output(GOOD_TEXT)))

    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: JD,
    })

    // 重试次数 = 默认 maxAttempts，且只落在那一条上
    expect(harness.attemptsOf(SLOW_ID)).toBe(3)
    expect(harness.attemptsOf('b00')).toBe(1)
    expect(harness.attemptsOf('b39')).toBe(1)
    // 39 条 × 1 次 + 1 条 × 3 次
    expect(report.calls).toBe(42)

    // 一条失败没有拖垮整批
    expect(report.rewritten).toHaveLength(39)
    expect(report.failed.map((entry) => entry.bulletId)).toEqual([SLOW_ID])
    expect(report.concurrencyPeak).toBe(40)
  })

  it('失败的那条不会让别的条也进入失败清单', async () => {
    const candidates = ['b0', 'b1', 'b2'].map((id) => candidate(id))
    const harness = mockClient((id) => (id === 'b1' ? output(FABRICATED) : output(GOOD_TEXT)))

    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: JD,
    })

    expect(report.failed.map((entry) => entry.bulletId)).toEqual(['b1'])
    expect(report.rewritten.map((bullet) => bullet.bulletId)).toEqual(['b0', 'b2'])
  })
})

describe('锚点的两种来源', () => {
  it('首轮引导：分两批，峰值并发取两批中较大者', async () => {
    const candidates = fortyCandidates()
    const harness = mockClient(() => output(GOOD_TEXT), { delayMs: BASE_DELAY })

    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: JD,
      bootstrapAnchors: true,
      anchorCount: 3,
    })

    // 3 条先跑（3 并发），其余 37 条后跑（37 并发）—— 峰值是 37 而不是 40
    expect(report.concurrencyPeak).toBe(37)
    expect(report.anchors.map((anchor) => anchor.bulletId)).toEqual(['b00', 'b01', 'b02'])

    // 引导批次自己不带锚点，其余全部带
    const head = report.rewritten.filter((bullet) => ['b00', 'b01', 'b02'].includes(bullet.bulletId))
    expect(head.map((bullet) => bullet.anchorsUsed)).toEqual([[], [], []])
    const tail = report.rewritten.filter((bullet) => bullet.bulletId === 'b39')
    expect(tail[0]?.anchorsUsed).toEqual(['b00', 'b01', 'b02'])
    expect(report.calls).toBe(40)
  })

  it('引导批次里失败的条目不得成为锚点', async () => {
    const candidates = fortyCandidates()
    const harness = mockClient((id) => (id === 'b00' ? output(FABRICATED) : output(GOOD_TEXT)))

    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: JD,
      bootstrapAnchors: true,
      anchorCount: 3,
    })

    // b00 编了数字，只有 b01 / b02 有资格当范例
    expect(report.anchors.map((anchor) => anchor.bulletId)).toEqual(['b01', 'b02'])
    const later = report.rewritten.find((bullet) => bullet.bulletId === 'b39')
    expect(later?.anchorsUsed).toEqual(['b01', 'b02'])
    // 而且那两条锚点的文字里，不含 b00 那份失败产物
    const anchorTexts = report.anchors.map((anchor) => anchor.text)
    expect(anchorTexts).not.toContain(FABRICATED)
  })

  it('外部锚点（上一轮定稿）：不分批，40 条照样全量并发', async () => {
    const candidates = fortyCandidates()
    const harness = mockClient(() => output(GOOD_TEXT), { delayMs: BASE_DELAY })
    const anchors = [
      { bulletId: 'seed.0', text: '主导推荐系统召回策略迭代，覆盖 12 个场景' },
      { bulletId: 'seed.1', text: '重构特征回填链路，耗时从 4.2 小时降至 38 分钟' },
    ]

    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: JD,
      anchors,
      anchorCount: 3,
    })

    expect(report.concurrencyPeak).toBe(40)
    expect(report.anchors).toEqual(anchors)
    expect(report.rewritten.every((bullet) => bullet.anchorsUsed.join(',') === 'seed.0,seed.1')).toBe(
      true,
    )
  })

  it('anchorCount 为 0：即使打开首轮引导也不分批', async () => {
    const candidates = fortyCandidates()
    const harness = mockClient(() => output(GOOD_TEXT), { delayMs: BASE_DELAY })

    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: JD,
      bootstrapAnchors: true,
      anchorCount: 0,
    })

    expect(report.concurrencyPeak).toBe(40)
    expect(report.anchors).toEqual([])
  })
})
