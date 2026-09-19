import { describe, expect, it } from 'vitest'

import {
  GENERIC_FORM_HTML,
  MOCKBOARD_FORM_HTML,
} from '../fill/__fixtures__/form-html'
import { fillTestArchive } from '../fill/__fixtures__/fill-archive'
import { parseHtmlFixture } from '../fill/__fixtures__/parse'
import { approveFill, openPanel, splitPreviewColumns, unlockPanel } from './panel'
import { createDomFillWriter } from './writer'

/**
 * T7.2 —— 预览确认面板的纯逻辑层。
 *
 * 三条 TASKS 验收在这里的落法：
 * 1. 「分列展示」= `splitPreviewColumns`（T5.5 语义：adapter=自动填 /
 *    heuristic=启发式猜），ready 状态携带的 preview 是唯一数据源；
 * 2. 「批准 → 真写入」= `approveFill` 串 T5.3 的票（createConfirmation →
 *    applyFillPlan），writer 是真实 DOM 写入器 —— jsdom 上逐字段核对；
 * 3. 「未解锁明确提示，不半残」= locked / unlock-failed 状态**结构上
 *    不携带 preview** —— `Object.hasOwn(state, 'preview')` 为假，
 *    渲染层想画半残面板都拿不到数据。
 */

const EMPTY_PAGE_HTML = '<!doctype html><html lang="zh-CN"><body></body></html>'

/** 造一个版本错位的 mockboard 页面 —— staleAdapter 的第一现场。 */
const STALE_MOCKBOARD_HTML = MOCKBOARD_FORM_HTML.replace(
  'data-platform-version="1"',
  'data-platform-version="9"',
)

/** 按 key 读回 jsdom 元素的 value 属性（真实 DOM 写入的回读缝）。 */
function valueOf(doc: ReturnType<typeof parseHtmlFixture>, key: string): string {
  const el = doc.getElementById(key)
  if (el === null) throw new Error(`fixture 里没有 #${key}`)
  return (el as unknown as { value: string }).value
}

describe('openPanel：扫描结果 → 面板状态', () => {
  it('空页面 → closed（没有表单就不打扰）', () => {
    const state = openPanel(
      { platform: null, pageVersion: null, adapterVersion: null, staleAdapter: false, featureCount: 0 },
      parseHtmlFixture(EMPTY_PAGE_HTML),
      null,
    )
    expect(state.kind).toBe('closed')
  })

  it('有表单 + 档案未解锁 → locked；状态上结构性地没有 preview（半残不存在）', () => {
    const state = openPanel(
      { platform: null, pageVersion: null, adapterVersion: null, staleAdapter: false, featureCount: 20 },
      parseHtmlFixture(GENERIC_FORM_HTML),
      null,
    )
    expect(state.kind).toBe('locked')
    expect(Object.hasOwn(state, 'preview')).toBe(false)
    expect(Object.hasOwn(state, 'plan')).toBe(false)
  })

  it('已解锁档案 → ready：staleAdapter 透传，preview 携带分列计数', () => {
    const state = openPanel(
      { platform: 'mockboard', pageVersion: '9', adapterVersion: '1', staleAdapter: true, featureCount: 5 },
      parseHtmlFixture(STALE_MOCKBOARD_HTML),
      fillTestArchive(),
    )
    expect(state.kind).toBe('ready')
    if (state.kind !== 'ready') return
    expect(state.staleAdapter).toBe(true)
    expect(state.preview.counts.fill).toBeGreaterThan(0)
  })

  it('unlockPanel：解锁失败 → unlock-failed（依旧没有 preview），成功 → ready', () => {
    const doc = parseHtmlFixture(GENERIC_FORM_HTML)
    const locked = openPanel(
      { platform: null, pageVersion: null, adapterVersion: null, staleAdapter: false, featureCount: 20 },
      doc,
      null,
    )
    const failed = unlockPanel(locked, 'wrong-passphrase', () => null, doc)
    expect(failed.kind).toBe('unlock-failed')
    expect(Object.hasOwn(failed, 'preview')).toBe(false)

    const ok = unlockPanel(locked, 'right-passphrase', () => fillTestArchive(), doc)
    expect(ok.kind).toBe('ready')
  })
})

describe('splitPreviewColumns：T5.5 分列语义进面板', () => {
  it('adapter=自动填 / heuristic=启发式猜，两列互斥、并集等于全部 fill', () => {
    const state = openPanel(
      { platform: 'mockboard', pageVersion: '1', adapterVersion: '1', staleAdapter: false, featureCount: 5 },
      parseHtmlFixture(MOCKBOARD_FORM_HTML),
      fillTestArchive(),
    )
    if (state.kind !== 'ready') throw new Error('应当 ready')
    const columns = splitPreviewColumns(state.preview)

    for (const item of [...columns.autoFilled, ...columns.heuristicGuessed]) {
      expect(item.kind).toBe('fill')
    }
    expect(columns.autoFilled.every((i) => i.source === 'adapter')).toBe(true)
    expect(columns.heuristicGuessed.every((i) => i.source === 'heuristic')).toBe(true)
    expect(columns.autoFilled.length + columns.heuristicGuessed.length).toBe(
      state.preview.counts.fill,
    )
    expect(columns.autoFilled.length).toBe(state.preview.counts.fillByAdapter)
    expect(columns.heuristicGuessed.length).toBe(state.preview.counts.fillByHeuristic)
  })
})

describe('approveFill：批准 → 凭据 → 真实 DOM 写入', () => {
  const scan = { platform: null, pageVersion: null, adapterVersion: null, staleAdapter: false, featureCount: 20 }

  it('空批准 → applied 且 DOM 逐字节不变（无批准零写入，jsdom 复验）', () => {
    const doc = parseHtmlFixture(GENERIC_FORM_HTML)
    const before = ['f-name', 'f-phone', 'f-email', 'f-captcha'].map((k) => valueOf(doc, k))
    const state = openPanel(scan, doc, fillTestArchive())
    if (state.kind !== 'ready') throw new Error('应当 ready')

    const applied = approveFill(state, [], createDomFillWriter(doc))
    expect(applied.kind).toBe('applied')
    if (applied.kind !== 'applied') return
    expect(applied.result.appliedKeys).toEqual([])

    const after = ['f-name', 'f-phone', 'f-email', 'f-captcha'].map((k) => valueOf(doc, k))
    expect(after).toEqual(before)
  })

  it('部分批准 → 只有批准的字段落值；缺口字段（f-captcha）与未批字段保持原值', () => {
    const doc = parseHtmlFixture(GENERIC_FORM_HTML)
    const state = openPanel(scan, doc, fillTestArchive())
    if (state.kind !== 'ready') throw new Error('应当 ready')

    const applied = approveFill(state, ['f-name', 'f-phone'], createDomFillWriter(doc))
    if (applied.kind !== 'applied') throw new Error('应当 applied')
    expect(applied.result.appliedKeys).toEqual(['f-name', 'f-phone'])
    expect(valueOf(doc, 'f-name')).toBe('张智远')
    expect(valueOf(doc, 'f-phone')).toBe('13800138000')
    expect(valueOf(doc, 'f-email')).toBe('') // 档案里有但没批 → 不写
    expect(valueOf(doc, 'f-captcha')).toBe('') // gap 结构上进不了任何写入
  })

  it('批了没有资格的 key（gap / 不存在）→ 原样抛错，不静默忽略', () => {
    const doc = parseHtmlFixture(GENERIC_FORM_HTML)
    const state = openPanel(scan, doc, fillTestArchive())
    if (state.kind !== 'ready') throw new Error('应当 ready')
    expect(() => approveFill(state, ['f-captcha'], createDomFillWriter(doc))).toThrow()
    expect(() => approveFill(state, ['no-such-key'], createDomFillWriter(doc))).toThrow()
  })

  it('locked / closed / applied 状态不可批 —— 二次写入没有入口（错误语义也要明确）', () => {
    const doc = parseHtmlFixture(GENERIC_FORM_HTML)
    const locked = openPanel({ ...scan }, doc, null)
    expect(() => approveFill(locked, [], createDomFillWriter(doc))).toThrow(
      /只有 ready 能批准/,
    )

    const state = openPanel({ ...scan }, doc, fillTestArchive())
    if (state.kind !== 'ready') throw new Error('应当 ready')
    const applied = approveFill(state, ['f-name'], createDomFillWriter(doc))
    expect(() => approveFill(applied, ['f-email'], createDomFillWriter(doc))).toThrow(
      /applied 是终态/,
    )
  })
})

describe('createDomFillWriter：key 寻址的真实写入', () => {
  const RADIO_FORM_HTML = `<!doctype html><html><body>
    <input type="radio" name="gender" value="M">
    <input type="radio" name="gender" value="F">
  </body></html>`

  function radioChecked(doc: ReturnType<typeof parseHtmlFixture>, value: string): boolean {
    const el = doc.querySelectorAll(`input[type="radio"][value="${value}"]`)[0]
    if (el === undefined) throw new Error(`没有 value=${value} 的成员`)
    return (el as unknown as { checked: boolean }).checked
  }

  it('radio 组：勾中对应成员、取消其余（组语义，不是改第一个的 value）', () => {
    const doc = parseHtmlFixture(RADIO_FORM_HTML)
    const writer = createDomFillWriter(doc)
    writer.setValue('gender', 'F')
    expect(radioChecked(doc, 'F')).toBe(true)
    expect(radioChecked(doc, 'M')).toBe(false)

    writer.setValue('gender', 'M')
    expect(radioChecked(doc, 'M')).toBe(true)
    expect(radioChecked(doc, 'F')).toBe(false)
  })

  it('计划里的 key 在页面上找不到 → 抛错（计划与页面脱节不静默）', () => {
    const doc = parseHtmlFixture(EMPTY_PAGE_HTML)
    const writer = createDomFillWriter(doc)
    expect(() => writer.setValue('f-name', 'x')).toThrow(/找不到/)
  })
})
