import { describe, expect, it } from 'vitest'

import { serializeArchive } from '../../../core/src/schema/index'
import { verifySubmitRelease, type SubmitSummary } from '../fill/submit-review'
import { GENERIC_FORM_HTML } from '../fill/__fixtures__/form-html'
import { fillTestArchive } from '../fill/__fixtures__/fill-archive'
import { parseHtmlFixture } from '../fill/__fixtures__/parse'
import type { BackfillDecision } from '../fill/backfill'
import {
  approveFill,
  openPanel,
  openSubmitReview,
  releaseSubmitFlow,
  type PanelState,
} from './panel'
import { createDomFillWriter, readPageValues } from './writer'

/**
 * T7.3 —— 提交前摘要 + 回填接线（T5.5 门与 T5.6 提案进面板状态机）。
 *
 * 时序即语义：fill 全部写入之后，用户去点**页面自己的提交按钮**，
 * 面板在这一刻拦截（`openSubmitReview`）——
 * - 摘要分列（T5.5）：自动填 / 启发式猜，emptyRequired 是 preview 的投影；
 * - 回填提案（T5.6）：提交时刻表单值 vs 计划 vs 档案，new / conflict
 *   分诊，outbid / ambiguous 缺口永不进提案；
 * - 放行一次性（T5.5）：release 与回填决策同一次点击交给
 *   `releaseSubmitFlow`，第二次放行没有入口。
 *
 * 档案写回的落点（saveArchive）是入口胶水的事 —— 状态机把写回后的
 * 档案作为 `archiveAfter` 带出来，交谁保存与状态机无关。
 */

const GENERIC_SCAN = {
  platform: null,
  pageVersion: null,
  adapterVersion: null,
  staleAdapter: false,
  featureCount: 20,
} as const

/** 提交时刻的表单值：改了手机号、手填了验证码、手填了紧急联系人电话。 */
const SUBMIT_PAGE_VALUES: Readonly<Record<string, string>> = {
  'f-phone': '13900139000',
  'f-captcha': '8888',
  'f-emergency': '13700000000',
}

function appliedPanel(): {
  doc: ReturnType<typeof parseHtmlFixture>
  state: Extract<PanelState, { kind: 'applied' }>
} {
  const doc = parseHtmlFixture(GENERIC_FORM_HTML)
  const ready = openPanel(GENERIC_SCAN, doc, fillTestArchive())
  if (ready.kind !== 'ready') throw new Error('应当 ready')
  const applied = approveFill(ready, ready.preview.approvableKeys, createDomFillWriter(doc))
  if (applied.kind !== 'applied') throw new Error('应当 applied')
  return { doc, state: applied }
}

describe('openSubmitReview：提交时刻的拦截', () => {
  it('ready / locked 状态不可开 —— 没写完就拦截是半成品流程', () => {
    const doc = parseHtmlFixture(GENERIC_FORM_HTML)
    const ready = openPanel(GENERIC_SCAN, doc, fillTestArchive())
    expect(() => openSubmitReview(ready, fillTestArchive(), SUBMIT_PAGE_VALUES)).toThrow(
      /applied/,
    )
    const locked = openPanel(GENERIC_SCAN, doc, null)
    expect(() => openSubmitReview(locked, fillTestArchive(), SUBMIT_PAGE_VALUES)).toThrow(
      /applied/,
    )
  })

  it('拦截成功：摘要分列 + 提案分诊（conflict / new），outbid 缺口永不进提案', () => {
    const { state } = appliedPanel()
    const review = openSubmitReview(state, fillTestArchive(), SUBMIT_PAGE_VALUES)
    if (review.kind !== 'submit-review') throw new Error('应当 submit-review')

    // 摘要：与 preview 同源（T5.5 的投影语义）
    expect(review.summary.autoFilled.every((i) => i.source === 'adapter')).toBe(true)
    expect(review.summary.heuristicGuessed.every((i) => i.source === 'heuristic')).toBe(true)
    expect(review.summary.autoFilled.length + review.summary.heuristicGuessed.length).toBe(
      state.preview.counts.fill,
    )
    expect(review.summary.emptyRequired).toEqual(state.preview.blockingGaps)
    expect(review.gate.released).toBe(false)

    // 提案：f-phone 改过 → conflict；f-captcha 手填（目录认不出）→ customFields new；
    // f-emergency 是 outbid 缺口 —— path 归属不可信，回填即污染，永不进提案
    const byId = new Map(review.proposal.items.map((i) => [i.id, i]))
    expect(review.proposal.items).toHaveLength(2)
    expect(byId.get('f-phone')).toMatchObject({
      status: 'conflict',
      target: { kind: 'path', path: 'basics.contact.phone' },
      pageValue: '13900139000',
      archiveValue: '13800138000',
    })
    expect(byId.get('f-captcha')).toMatchObject({
      status: 'new',
      target: { kind: 'custom', cfKey: 'f-captcha' },
      pageValue: '8888',
      archiveValue: null,
    })
    expect(byId.has('f-emergency')).toBe(false)
  })

  it('未改动的字段不进提案（same 没有信息量，问它就是打扰）', () => {
    const { state } = appliedPanel()
    // 只交手机号原值 —— 与计划值一致，不算手填
    const review = openSubmitReview(state, fillTestArchive(), {
      'f-phone': '13800138000',
    })
    if (review.kind !== 'submit-review') throw new Error('应当 submit-review')
    expect(review.proposal.items).toEqual([])
  })
})

describe('releaseSubmitFlow：一次点击 = 放行 + 回填决策', () => {
  it('决策回填：phone 写回档案；没决策的提案条目（captcha）不写', () => {
    const { state } = appliedPanel()
    const archive = fillTestArchive()
    const review = openSubmitReview(state, archive, SUBMIT_PAGE_VALUES)
    if (review.kind !== 'submit-review') throw new Error('应当 submit-review')

    const after = releaseSubmitFlow(review, [{ id: 'f-phone' }])
    if (after.kind !== 'submit-released') throw new Error('应当 submit-released')

    // 凭据可用：验收仪式在流程内走完（形状 + digest 对上当前摘要）
    expect(() => verifySubmitRelease(after.release, review.summary)).not.toThrow()
    expect(after.archiveAfter.basics.contact.phone).toBe('13900139000')
    expect(after.archiveAfter.customFields['f-captcha']).toBeUndefined()
    // 没决策的 conflict（无）与 new（captcha）都保留缺省 —— keep 是缺省
    expect(after.archiveAfter.basics.contact.wechat).toBe('zhangzy_1988')
  })

  it('空决策 = 放行但档案逐字节不变（不静默保存，冲突保留原值）', () => {
    const { state } = appliedPanel()
    const archive = fillTestArchive()
    const review = openSubmitReview(state, archive, SUBMIT_PAGE_VALUES)
    if (review.kind !== 'submit-review') throw new Error('应当 submit-review')

    const after = releaseSubmitFlow(review, [])
    if (after.kind !== 'submit-released') throw new Error('应当 submit-released')
    expect(serializeArchive(after.archiveAfter)).toBe(serializeArchive(archive))
  })

  it('只拦截一次：第二次放行没有入口', () => {
    const { state } = appliedPanel()
    const review = openSubmitReview(state, fillTestArchive(), SUBMIT_PAGE_VALUES)
    if (review.kind !== 'submit-review') throw new Error('应当 submit-review')
    expect(() => releaseSubmitFlow(review, [])).not.toThrow()
    expect(() => releaseSubmitFlow(review, [])).toThrow(/已经放行过/)
  })

  it('不配套的决策（提案里没有的 id）→ 拒绝而不静默忽略', () => {
    const { state } = appliedPanel()
    const review = openSubmitReview(state, fillTestArchive(), SUBMIT_PAGE_VALUES)
    if (review.kind !== 'submit-review') throw new Error('应当 submit-review')
    const bad: readonly BackfillDecision[] = [{ id: 'no-such-id' }]
    expect(() => releaseSubmitFlow(review, bad)).toThrow(/不配套/)
  })
})

describe('readPageValues：提交时刻表单值的读取', () => {
  it('jsdom 上写入再读回，逐字段一致', () => {
    const doc = parseHtmlFixture(GENERIC_FORM_HTML)
    const writer = createDomFillWriter(doc)
    writer.setValue('f-phone', '13900139000')

    const values = readPageValues(doc)
    expect(values['f-phone']).toBe('13900139000')
    expect(values['f-name']).toBe('') // 没写的字段读到空串，不是 undefined —— 统一形状
  })
})

describe('类型面：SubmitSummary 形状稳定（快照守卫，防分列口径漂移）', () => {
  it('summary 的键集固定', () => {
    const { state } = appliedPanel()
    const review = openSubmitReview(state, fillTestArchive(), SUBMIT_PAGE_VALUES)
    if (review.kind !== 'submit-review') throw new Error('应当 submit-review')
    const summary: SubmitSummary = review.summary
    expect(Object.keys(summary).sort()).toEqual([
      'autoFilled',
      'digest',
      'emptyRequired',
      'fileSlots',
      'heuristicGuessed',
    ])
  })
})
