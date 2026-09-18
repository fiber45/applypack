/**
 * 上下文分层与出网边界 —— DESIGN 8.1 / 8.2 的可断言形式。
 *
 * 8.1 有一句话是本项目里最容易被违反、又最难在 review 里看出来的：
 *
 *   「把 JD 摆在档案之前是常见错误，会让缓存全部失效」
 *
 * 「常见错误」意味着它会**自然发生** —— 只要有人觉得「先给 JD 更符合直觉」，
 * 就会写出 `volatile.unshift(jd)`。而它的症状是账单变贵，没有任何功能异常。
 * 所以这里不写「注意顺序」，写一条断言：**JD 的标识串不得出现在缓存前缀里**。
 *
 * 8.2 的「必须保留未经改写的原文」同样被钉在这里：任务消息里逐字出现
 * `sourceText`，且这个字段是候选上唯一的文本字段（另一条断言在 types.ts 的说明里，
 * 靠类型系统保证 —— 想加一个 `summary` 字段，先得改 `RewriteCandidate`）。
 */

import { describe, expect, it } from 'vitest'

import type { CompiledJd } from '../compile/index'
import { blockingLeaks, scanPayload } from '../egress/index'
import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import {
  bulletIdOf,
  candidate,
  GOOD_TEXT,
  JD,
  jdMessageOf,
  mockClient,
  output,
  SOURCE_TEXT,
  taskOf,
  type MockHarness,
} from './__fixtures__/harness'
import { REWRITE_SYSTEM_PROMPT } from './prompt'
import { rewriteBullets } from './rewrite'

/** 按 bulletId 取那一条的任务消息 —— 不依赖请求的先后次序。 */
function taskFor(harness: MockHarness, bulletId: string): string {
  const request = harness.seen.find((item) => bulletIdOf(item) === bulletId)
  if (request === undefined) throw new Error(`mock 没有收到 ${bulletId} 的请求`)
  return taskOf(request)
}

/** 首次请求（不含重试）。 */
function firstRequest(harness: MockHarness): (typeof harness.seen)[number] {
  const request = harness.seen[0]
  if (request === undefined) throw new Error('应当有请求')
  return request
}

const REFERENCE = '改写范例（few-shot）：\n把「参与了推荐系统的开发工作」改为「主导推荐系统召回链路重构」。'

/**
 * 一组**哨兵串**：它们只可能来自 JD 消息。用它们而不是复用 `JD`，
 * 是因为满档案 fixture 里恰好也有「推荐系统」「PyTorch」这些词 ——
 * 那样的断言会在与顺序无关的情况下意外通过。
 */
const SENTINEL_JD: CompiledJd = {
  title: '数据平台研发工程师',
  company: '示例公司',
  hardRequirements: [{ kind: 'degree', text: '硕士及以上学历', strict: true }],
  skills: [{ name: 'Flink', proficiency: 'expert', required: true, evidence: '精通 Flink' }],
  responsibilities: ['构建实时数仓与指标平台'],
  register: 'technical',
  language: 'zh',
}

const B_LEVEL_PHONE = '+8613800138000'
const B_LEVEL_ID = '330106200205140011'

describe('上下文分层：三段的结构与顺序', () => {
  it('缓存前缀 = 系统提示 → few-shot → A 级档案（顺序固定）', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: SENTINEL_JD,
      archive: maximalArchiveV1,
      reference: REFERENCE,
    })

    const request = firstRequest(harness)
    expect(request.cachedPrefix).toHaveLength(3)
    expect(request.cachedPrefix[0]?.content).toBe(REWRITE_SYSTEM_PROMPT)
    expect(request.cachedPrefix[1]?.content).toBe(REFERENCE)
    // 第三段是投影后的 A 级档案，不是档案本身
    expect(request.cachedPrefix[2]?.content).toContain('推荐系统')
  })

  it('易变段 = 结构化 JD → 本轮任务（顺序固定）', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: SENTINEL_JD,
      archive: maximalArchiveV1,
      reference: REFERENCE,
    })

    const request = firstRequest(harness)
    expect(request.volatile).toHaveLength(2)
    expect(request.volatile[0]?.content).toContain('<jd>')
    expect(request.volatile[0]?.content).toContain('数据平台研发工程师')
    expect(request.volatile[1]?.content).toContain('<candidate id="b0"')
  })

  it('JD 绝不落在缓存前缀里 —— 8.1 那个「常见错误」的回归断言', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: SENTINEL_JD,
      archive: maximalArchiveV1,
      reference: REFERENCE,
    })

    const request = firstRequest(harness)
    const cached = request.cachedPrefix.map((message) => message.content).join('\n')
    expect(cached).not.toContain(SENTINEL_JD.title)
    expect(cached).not.toContain('Flink')
    expect(cached).not.toContain('构建实时数仓与指标平台')
  })

  it('40 次请求的缓存前缀逐字相同 —— 这是缓存能命中的前提', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    const candidates = Array.from({ length: 40 }, (_, index) => candidate(`b${index}`))
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: SENTINEL_JD,
      archive: maximalArchiveV1,
      reference: REFERENCE,
    })

    const distinct = new Set(harness.seen.map((request) => JSON.stringify(request.cachedPrefix)))
    expect(distinct.size).toBe(1)
  })

  it('不传档案时缓存前缀只到系统提示为止，不留下一个空的 {}', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: SENTINEL_JD,
    })

    const request = firstRequest(harness)
    expect(request.cachedPrefix).toHaveLength(1)
    expect(request.cachedPrefix[0]?.content).toBe(REWRITE_SYSTEM_PROMPT)
  })
})

describe('上下文裁剪：每条只带四项，且原文一字不改', () => {
  it('未经改写的原文逐字出现在任务消息里', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: SENTINEL_JD,
    })

    const request = firstRequest(harness)
    expect(taskOf(request)).toContain(SOURCE_TEXT)
  })

  it('任务消息里没有 JD 原文，只有结构化摘要', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: SENTINEL_JD,
    })

    const request = firstRequest(harness)
    // 摘要在 JD 消息里，任务消息里不该再抄一份
    expect(taskOf(request)).not.toContain('数据平台研发工程师')
    expect(jdMessageOf(request)).toContain('数据平台研发工程师')
  })

  it('重试之后原文仍然是那份原文', async () => {
    const harness = mockClient((_id, attempt) =>
      attempt === 0 ? output('重构推荐系统召回链路，将回填耗时降低 40%') : output(GOOD_TEXT),
    )
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: SENTINEL_JD,
    })

    for (const request of harness.seen) {
      expect(taskOf(request)).toContain(SOURCE_TEXT)
    }
  })
})

describe('出网边界：B 级数据一次都不许出现', () => {
  it('满档案 + 40 条改写：全部捕获请求的阻断级命中为零', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    const candidates = Array.from({ length: 40 }, (_, index) => candidate(`b${index}`))
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: SENTINEL_JD,
      archive: maximalArchiveV1,
      reference: REFERENCE,
    })

    expect(harness.seen).toHaveLength(40)
    for (const request of harness.seen) {
      expect(blockingLeaks(scanPayload(request, maximalArchiveV1))).toEqual([])
    }
  })

  it('反向验证：那份档案里真的有这些 B 级值，否则上面那条不算数', () => {
    const raw = JSON.stringify(maximalArchiveV1)
    expect(raw).toContain(B_LEVEL_PHONE)
    expect(raw).toContain(B_LEVEL_ID)
  })

  it('反向验证：同一份档案的 A 级内容确实进了载荷，投影没有把整份档案变成空', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: SENTINEL_JD,
      archive: maximalArchiveV1,
    })

    const request = firstRequest(harness)
    const cached = request.cachedPrefix.map((message) => message.content).join('\n')
    expect(cached).toContain('推荐系统')
    expect(cached).toContain('特征工程')
  })
})

describe('锚点在载荷里的位置', () => {
  it('无锚点时任务消息里不出现 <style_anchors> 空标签', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0')],
      jd: JD,
    })

    const request = firstRequest(harness)
    expect(taskOf(request)).not.toContain('<style_anchors>')
  })

  it('外部锚点的文字真的进了每一条请求', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    const anchorText = '主导推荐系统召回策略迭代，覆盖 12 个场景'
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates: [candidate('b0'), candidate('b1'), candidate('b2')],
      jd: JD,
      anchors: [{ bulletId: 'seed.0', text: anchorText }],
    })

    for (const request of harness.seen) {
      expect(taskOf(request)).toContain('<style_anchors>')
      expect(taskOf(request)).toContain(anchorText)
    }
  })

  it('首轮引导时，引导批次自己的请求里没有锚点', async () => {
    const harness = mockClient(() => output(GOOD_TEXT))
    const candidates = ['b0', 'b1', 'b2', 'b3', 'b4'].map((id) => candidate(id))
    await rewriteBullets({
      client: harness.client,
      model: 'm',
      candidates,
      jd: JD,
      bootstrapAnchors: true,
      anchorCount: 2,
    })

    // 前两条（b0、b1）的请求不带锚点，其后的都带
    expect(taskFor(harness, 'b0')).not.toContain('<style_anchors>')
    expect(taskFor(harness, 'b1')).not.toContain('<style_anchors>')
    expect(taskFor(harness, 'b3')).toContain('<style_anchors>')
    expect(taskFor(harness, 'b3')).toContain(GOOD_TEXT)
  })
})
