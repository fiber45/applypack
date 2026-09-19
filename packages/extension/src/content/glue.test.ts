import { describe, expect, it, vi } from 'vitest'

import { resetPlatformAdaptersForTests } from '../fill/adapters'
import { registerBuiltinPlatformAdapters } from '../fill/platforms'
import {
  GENERIC_FORM_HTML,
  MOCKBOARD_FORM_HTML,
} from '../fill/__fixtures__/form-html'
import { fillTestArchive } from '../fill/__fixtures__/fill-archive'
import { parseHtmlFixture } from '../fill/__fixtures__/parse'
import { approveFill, openPanel, releaseSubmitFlow, openSubmitReview } from './panel'
import { createDomFillWriter, readPageValues } from './writer'
import { persistArchiveAfterRelease } from './glue'

resetPlatformAdaptersForTests()
registerBuiltinPlatformAdapters()

function reachReleased(html: string) {
  const doc = parseHtmlFixture(html)
  const scan = { platform: null, pageVersion: null, adapterVersion: null, staleAdapter: false, featureCount: 3 }
  const state = openPanel(scan, doc, fillTestArchive())
  if (state.kind !== 'ready') throw new Error('应当 ready')
  const fillKeys = state.preview.plan.items.flatMap((i) => (i.kind === 'fill' ? [i.key] : []))
  const applied = approveFill(state, fillKeys, createDomFillWriter(doc))
  if (applied.kind !== 'applied') throw new Error('应当 applied')
  const review = openSubmitReview(applied, fillTestArchive(), readPageValues(doc))
  if (review.kind !== 'submit-review') throw new Error('应当 submit-review')
  return releaseSubmitFlow(review, [])
}

describe('T7.4 persistArchiveAfterRelease —— 保存胶水', () => {
  it('submit-released 状态 → 注入的保存器收到 archiveAfter，恰好一次', async () => {
    const released = reachReleased(GENERIC_FORM_HTML)
    if (released.kind !== 'submit-released') throw new Error('应当 submit-released')
    const saveArchive = vi.fn<(a: unknown) => Promise<void>>().mockResolvedValue(undefined)
    const outcome = await persistArchiveAfterRelease(released, saveArchive)
    expect(outcome).toBe('saved')
    expect(saveArchive).toHaveBeenCalledTimes(1)
    expect(saveArchive).toHaveBeenCalledWith(released.archiveAfter)
  })

  it('其余任何状态都不允许保存 —— applied 也没有 archiveAfter，保存只能发生在放行之后', async () => {
    const doc = parseHtmlFixture(GENERIC_FORM_HTML)
    const scan = { platform: null, pageVersion: null, adapterVersion: null, staleAdapter: false, featureCount: 3 }
    const state = openPanel(scan, doc, fillTestArchive())
    if (state.kind !== 'ready') throw new Error('应当 ready')
    const applied = approveFill(state, ['f-name'], createDomFillWriter(doc))
    const saveArchive = vi.fn<(a: unknown) => Promise<void>>().mockResolvedValue(undefined)
    await expect(persistArchiveAfterRelease(applied, saveArchive)).rejects.toThrow(/只有 submit-released/)
    expect(saveArchive).not.toHaveBeenCalled()
  })

  it('保存器失败不吞 —— 错误原样上抛，调用方决定重试还是放弃', async () => {
    const released = reachReleased(MOCKBOARD_FORM_HTML)
    if (released.kind !== 'submit-released') throw new Error('应当 submit-released')
    const saveArchive = vi.fn<(a: unknown) => Promise<void>>().mockRejectedValue(new Error('磁盘已满'))
    await expect(persistArchiveAfterRelease(released, saveArchive)).rejects.toThrow('磁盘已满')
  })
})
