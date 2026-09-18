import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { candidate, GOOD_TEXT, JD, mockClient, output, SOURCE_TEXT, taskOf } from './__fixtures__/harness'
import * as rewriteModule from './index'
import { REWRITE_SYSTEM_PROMPT } from './prompt'
import { rewriteBullets } from './rewrite'
import { rewriteOutputSchema } from './schema'

/** 编了一个原文里没有的数字：原文只有 12 / 4.2 / 38。 */
const FABRICATED = '重构推荐系统召回链路，将回填耗时降低 40%'

describe('改写：二值契约', () => {
  it('一次通过：返回产物，attempts 为 1', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: JD,
    })

    expect(report.failed).toHaveLength(0)
    const bullet = report.rewritten[0]
    expect(bullet?.text).toBe(GOOD_TEXT)
    expect(bullet?.attempts).toBe(1)
    expect(report.calls).toBe(1)
    expect(report.anchors).toEqual([])
  })

  it('编造数字 → 重试 → 第二次改好后通过', async () => {
    const harness = mockClient((_id, attempt) =>
      attempt === 0 ? output(FABRICATED) : output(GOOD_TEXT),
    )
    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: JD,
    })

    expect(report.rewritten[0]?.attempts).toBe(2)
    expect(report.calls).toBe(2)
    // 第二次请求里带着结构化反馈：违规内容（40）与失败原因都在
    const retry = harness.seen[1]
    const feedback = retry?.volatile.at(-1)?.content ?? ''
    expect(feedback).toContain('number_not_in_source')
    expect(feedback).toContain('40')
  })

  it('一直编造数字 → 耗尽次数即失败，且失败对象可读', async () => {
    const harness = mockClient(() => output(FABRICATED))
    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: JD,
      maxAttempts: 2,
    })

    expect(report.rewritten).toHaveLength(0)
    const failure = report.failed[0]
    expect(failure?.attempts).toBe(2)
    expect(failure?.failure.code).toBe('validation_failed')
    expect(failure?.failure.detail).toContain('number_not_in_source')
    expect(failure?.failure.detail).toContain('40')
    expect(harness.attemptsOf('b0')).toBe(2)
  })

  it('maxAttempts 给 0 或负数时被收敛为 1，而不是走一条从未赋值的崩溃路径', async () => {
    const harness = mockClient(() => output(FABRICATED))
    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: JD,
      maxAttempts: 0,
    })
    expect(harness.attemptsOf('b0')).toBe(1)
    expect(report.failed[0]?.attempts).toBe(1)
  })
})

describe('改写：结果的顺序与完整性', () => {
  it('产物顺序与候选顺序一致 —— 并发完成次序不参入结果顺序', async () => {
    const candidates = ['b0', 'b1', 'b2', 'b3', 'b4'].map((id) => candidate(id))
    // 让靠前的条目更慢：若结果按完成顺序排列，b0 会落到最后
    const harness = mockClient(() => output(GOOD_TEXT), {
      delayFor: (id) => (id === 'b0' ? 40 : id === 'b1' ? 30 : 5),
    })

    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: JD,
    })

    expect(report.rewritten.map((bullet) => bullet.bulletId)).toEqual([
      'b0',
      'b1',
      'b2',
      'b3',
      'b4',
    ])
  })

  it('失败项不会被静默丢掉：rewritten + failed === candidates.length', async () => {
    const candidates = ['b0', 'b1', 'b2', 'b3', 'b4'].map((id) => candidate(id))
    const harness = mockClient((id) => (id === 'b2' ? output(FABRICATED) : output(GOOD_TEXT)))

    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: JD,
    })

    expect(report.rewritten.length + report.failed.length).toBe(candidates.length)
    expect(report.rewritten.map((bullet) => bullet.bulletId)).toEqual(['b0', 'b1', 'b3', 'b4'])
    expect(report.failed.map((entry) => entry.bulletId)).toEqual(['b2'])
  })

  it('空候选：零调用、零产物，不抛错', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    const report = await rewriteBullets({ client: harness.client, model: 'm', candidates: [], jd: JD })

    expect(harness.seen).toHaveLength(0)
    expect(report.calls).toBe(0)
    expect(report.concurrencyPeak).toBe(0)
    expect(report.rewritten).toEqual([])
    expect(report.failed).toEqual([])
  })
})

describe('改写：溯源声明必须逐字来自原文', () => {
  it('sourceSpan 是转述而不是原文片段 → 拒绝并重试', async () => {
    const harness = mockClient((_id, attempt) =>
      attempt === 0
        ? output(GOOD_TEXT, { sourceSpan: '我把召回通道的特征工程重做了一遍' })
        : output(GOOD_TEXT),
    )
    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: JD,
    })

    expect(report.rewritten[0]?.attempts).toBe(2)
    const feedback = harness.seen[1]?.volatile.at(-1)?.content ?? ''
    expect(feedback).toContain('sourceSpan')
    expect(feedback).toContain('逐字')
  })

  it('evidence 里混入一条转述 → 同样被拒绝', async () => {
    const harness = mockClient((_id, attempt) =>
      attempt === 0
        ? output(GOOD_TEXT, { evidence: [SOURCE_TEXT, '把耗时压到了半小时级别'] })
        : output(GOOD_TEXT),
    )
    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: JD,
    })

    expect(report.rewritten[0]?.attempts).toBe(2)
    expect(harness.seen[1]?.volatile.at(-1)?.content).toContain('把耗时压到了半小时级别')
  })
})

describe('改写：重试提示的粒度', () => {
  it('只带 fatal / hard，不带 target 层 —— 否则模型会去「修」量化率而再编一个数字', async () => {
    // 弱开头（hard）且整条不含数字（于是量化率 0%，会产出 target 级失败）
    const weak = '参与推荐系统召回链路的特征工程重构与上线'
    const harness = mockClient((_id, attempt) =>
      attempt === 0 ? output(weak) : output(GOOD_TEXT),
    )
    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: JD,
    })

    expect(report.rewritten[0]?.attempts).toBe(2)
    const feedback = harness.seen[1]?.volatile.at(-1)?.content ?? ''
    expect(feedback).toContain('weak_verb_opening')
    expect(feedback).not.toContain('low_quantification')
    expect(feedback).not.toContain('low_keyword_coverage')
  })

  it('不整体回显模型原文：重试载荷里没有上一轮那份 JSON', async () => {
    const harness = mockClient((_id, attempt) =>
      attempt === 0 ? output(FABRICATED) : output(GOOD_TEXT),
    )
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: JD,
    })

    const retry = harness.seen[1]
    const payload = retry?.volatile.map((message) => message.content).join('\n') ?? ''
    expect(payload).not.toContain('"sourceSpan"')
    expect(payload).not.toContain('"keywordsHit"')
    expect(retry?.volatile).toHaveLength(3)
  })

  it('重试时任务消息与首次逐字相同 —— 原文不因重试被改写', async () => {
    const harness = mockClient((_id, attempt) =>
      attempt === 0 ? output(FABRICATED) : output(GOOD_TEXT),
    )
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: JD,
    })

    const first = harness.seen[0]
    const retry = harness.seen[1]
    if (first === undefined || retry === undefined) throw new Error('应当有两次调用')
    expect(taskOf(retry)).toBe(taskOf(first))
    expect(taskOf(retry)).toContain(SOURCE_TEXT)
  })
})

describe('改写：数字的溯源范围是本条原文，不是整份档案', () => {
  it('把另一条原文里的数字搬过来 → 判为幻觉', async () => {
    const OTHER_SOURCE = '负责数据看板开发，服务 300 名内部用户，迭代 8 个版本。'
    // 12 来自 SOURCE_TEXT，不在 OTHER_SOURCE 里
    const harness = mockClient(() =>
      output('重构数据看板，服务 12 名内部用户', {
        sourceSpan: OTHER_SOURCE,
        evidence: [OTHER_SOURCE],
      }),
    )

    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b1', OTHER_SOURCE)],
      jd: JD,
      maxAttempts: 1,
    })

    expect(report.rewritten).toHaveLength(0)
    expect(report.failed[0]?.failure.detail).toContain('number_not_in_source')
    expect(report.failed[0]?.failure.detail).toContain('12')
  })
})

describe('改写：关键词命中由本地计算，不采信模型自报', () => {
  it('模型谎报命中不会进入 matchedKeywords', async () => {
    const harness = mockClient(() =>
      output(GOOD_TEXT, { keywordsHit: ['Kubernetes', 'Rust'] }),
    )
    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: JD,
    })

    const bullet = report.rewritten[0]
    expect(bullet?.declaredKeywords).toEqual(['Kubernetes', 'Rust'])
    expect(bullet?.matchedKeywords).toEqual(['推荐系统'])
  })

  it('没有 JD 时不做关键词判定，也不算命中', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    const report = await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
    })
    expect(report.rewritten[0]?.matchedKeywords).toEqual([])
  })
})

describe('改写：prompt 与 schema 不许漂移', () => {
  it('系统提示里嵌着从 schema 生成的形状说明', () => {
    const shape = JSON.stringify(z.toJSONSchema(rewriteOutputSchema), null, 2)
    expect(REWRITE_SYSTEM_PROMPT).toContain(shape)
  })

  it('导出面是固定的 —— 新增出网能力必须先改这一行', () => {
    expect(Object.keys(rewriteModule).sort()).toEqual([
      'DEFAULT_ANCHOR_COUNT',
      'REWRITE_SYSTEM_PROMPT',
      'anchorIds',
      'buildBulletTask',
      'buildJdMessage',
      'buildRetryMessage',
      'checkCandidate',
      'matchedKeywordsOf',
      'renderAnchorBlock',
      'rewriteBullets',
      'rewriteOne',
      'rewriteOutputSchema',
      'selectAnchors',
    ])
  })
})
