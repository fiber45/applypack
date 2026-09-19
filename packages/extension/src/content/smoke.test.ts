/**
 * T7.4 —— 全链冒烟：北森真实快照页，从 boot 到保存胶水一竿子到底。
 *
 * 这不是单元测试（每一段都有自己的单测与变异验证），而是**接线测试**：
 * 把 T7.1（扫描）→ T7.2（面板/写入）→ T7.3（提交拦截/放行）→
 * T7.4（保存胶水）按内容脚本的真实调用顺序串起来，钉住「链路上
 * 任何一环换了签名、改了语义，这里第一个红」。
 */

import { describe, expect, it } from 'vitest'

import { boot } from './entry'
import { approveFill, openPanel, releaseSubmitFlow, openSubmitReview } from './panel'
import { createDomFillWriter, readPageValues } from './writer'
import { persistArchiveAfterRelease } from './glue'
import { resetPlatformAdaptersForTests } from '../fill/adapters'
import { BEISEN_SNAPSHOT_HTML } from '../fill/__fixtures__/snapshot-beisen'
import { fillTestArchive } from '../fill/__fixtures__/fill-archive'
import { parseHtmlFixture } from '../fill/__fixtures__/parse'

resetPlatformAdaptersForTests() // boot 的默认注册路径会重新注册内置适配器

describe('T7.4 全链冒烟（北森快照页）', () => {
  it('boot → ready → 批准写入 → 提交拦截 → 放行 → 持久化，全链贯通', async () => {
    const doc = parseHtmlFixture(BEISEN_SNAPSHOT_HTML)

    // 1. boot：入口自己注册适配器并扫描 —— 检出北森、版本对齐，面板初始 locked
    const { scan, panel } = boot(doc)
    expect(panel.kind).toBe('locked')
    expect(scan.platform).toBe('beisen')
    expect(scan.staleAdapter).toBe(false)
    expect(scan.featureCount).toBeGreaterThan(0)

    // 2. 面板：解锁后的档案进来即 ready
    const state = openPanel(scan, doc, fillTestArchive())
    if (state.kind !== 'ready') throw new Error(`应当 ready，实际 ${state.kind}`)

    // 3. 批准全部 fill → 真实 DOM 写入
    const fillKeys = state.preview.plan.items.flatMap((i) => (i.kind === 'fill' ? [i.key] : []))
    const applied = approveFill(state, fillKeys, createDomFillWriter(doc))
    if (applied.kind !== 'applied') throw new Error(`应当 applied，实际 ${applied.kind}`)
    expect(applied.result.appliedKeys.length).toBeGreaterThan(0)

    // 4. 提交拦截：摘要分列 + 回填提案 + 门
    const review = openSubmitReview(applied, fillTestArchive(), readPageValues(doc))
    if (review.kind !== 'submit-review') throw new Error(`应当 submit-review，实际 ${review.kind}`)
    expect(review.summary.autoFilled.length + review.summary.heuristicGuessed.length).toBeGreaterThan(0)
    expect(review.proposal.items.every((i) => ['new', 'conflict'].includes(i.status))).toBe(true)

    // 5. 放行（空决策 = 档案逐字节不变）+ 6. 持久化胶水
    const released = releaseSubmitFlow(review, [])
    if (released.kind !== 'submit-released') throw new Error(`应当 submit-released，实际 ${released.kind}`)
    await expect(persistArchiveAfterRelease(released, async () => {})).resolves.toBe('saved')
  })
})
