/**
 * T9.2b —— overlay 渲染层：PanelState → 页面上的真 DOM。
 *
 * 渲染层**不发明语义**：它只把状态机的判别联合画出来 ——
 * `locked` 结构上没有 preview（类型事实），渲染层想画都画不出来；
 * `unlock-failed` 必须有一条可见的错误（「点了没反应」是 Web 端
 * 用一次真实事故换来的教训，扩展端不许重演）。
 *
 * 测试里的 DOM 是 jsdom（与 `parseHtmlFixture` 同一来源）；
 * 生产里是真实 `document` —— 两者都满足 overlay.ts 自己声明的
 * 结构化写入接口。状态对象全部走真实状态机（openPanel / approveFill /
 * openSubmitReview / releaseSubmitFlow），不造假预览。
 */
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

import { fillTestArchive } from '../fill/__fixtures__/fill-archive'
import { parseHtmlFixture } from '../fill/__fixtures__/parse'
import { BEISEN_SNAPSHOT_HTML } from '../fill/__fixtures__/snapshot-beisen'
import { createDomFillWriter, readPageValues } from './writer'
import { approveFill, openPanel, openSubmitReview, releaseSubmitFlow } from './panel'
import { renderOverlay, asOverlayRoot, type OverlayActions } from './overlay'

// ─── types:[] 下 jsdom 的 window 是 unknown —— 测试自己声明用到的最小结构面 ───

interface MiniElement {
  readonly innerHTML: string
  readonly textContent: string | null
  getAttribute(name: string): string | null
  value: string
  checked: boolean
  readOnly: boolean
  dispatchEvent(event: unknown): boolean
}

interface MiniDocument {
  getElementById(id: string): MiniElement | null
  querySelector(selectors: string): MiniElement | null
  querySelectorAll(selectors: string): ArrayLike<MiniElement>
}

function docOf(dom: JSDOM): MiniDocument {
  return dom.window.document as unknown as MiniDocument
}

function clickEl(dom: JSDOM, el: MiniElement): void {
  const ctor = (dom.window as unknown as { MouseEvent: new (type: string, init?: { bubbles: boolean }) => unknown })
    .MouseEvent
  el.dispatchEvent(new ctor('click', { bubbles: true }))
}

const PAGE_SCAN = {
  platform: 'beisen',
  pageVersion: 'snapshot-1',
  adapterVersion: 'snapshot-1',
  staleAdapter: false,
  featureCount: 9,
} as const

/** 建宿主页 + 渲染一次的脚手架。 */
function setup() {
  const dom = new JSDOM('<body><div id="applypack-overlay-host"></div></body>')
  const host = docOf(dom).getElementById('applypack-overlay-host')
  if (host === null) throw new Error('夹具缺宿主元素')
  return { dom, host }
}

/** locked → ready → applied → submit-review → submit-released 的真实链。 */
function realStates() {
  const doc = parseHtmlFixture(BEISEN_SNAPSHOT_HTML)
  const locked = openPanel(PAGE_SCAN, doc, null)
  const ready = openPanel(PAGE_SCAN, doc, fillTestArchive())
  if (ready.kind !== 'ready') throw new Error(`应当 ready，实际 ${ready.kind}`)
  const fillKeys = ready.preview.plan.items.flatMap((i) => (i.kind === 'fill' ? [i.key] : []))
  const applied = approveFill(ready, fillKeys, createDomFillWriter(doc))
  if (applied.kind !== 'applied') throw new Error(`应当 applied，实际 ${applied.kind}`)
  const review = openSubmitReview(applied, fillTestArchive(), readPageValues(doc))
  if (review.kind !== 'submit-review') throw new Error(`应当 submit-review，实际 ${review.kind}`)
  const released = releaseSubmitFlow(review, [])
  if (released.kind !== 'submit-released') {
    throw new Error(`应当 submit-released，实际 ${released.kind}`)
  }
  return { doc, locked, ready, applied, review, released, fillKeys }
}

describe('renderOverlay：状态即画面', () => {
  const noopActions = () =>
    ({ unlock: vi.fn(), approve: vi.fn(), review: vi.fn(), release: vi.fn() }) as OverlayActions

  it('closed → 宿主清空（页面上没有任何 applypack 痕迹）', () => {
    const { dom, host } = setup()
    renderOverlay(asOverlayRoot(dom.window.document), host, { kind: 'closed' }, noopActions())
    expect(host.innerHTML).toBe('')
  })

  it('locked → 信封粘贴框 + 口令框 + 解锁按钮；没有批准入口（无预览可批）', () => {
    const { dom, host } = setup()
    const { locked } = realStates()
    renderOverlay(asOverlayRoot(dom.window.document), host, locked, noopActions())

    expect(docOf(dom).querySelector('[data-testid="overlay-envelope"]')).not.toBeNull()
    const pass = docOf(dom).querySelector('[data-testid="overlay-passphrase"]')
    expect(pass).not.toBeNull()
    expect(pass?.getAttribute('type')).toBe('password')
    expect(docOf(dom).querySelector('[data-testid="overlay-unlock"]')).not.toBeNull()
    expect(docOf(dom).querySelector('[data-testid="overlay-approve"]')).toBeNull()
  })

  it('点解锁 → actions.unlock 收到框里粘贴的信封与口令原文', () => {
    const { dom, host } = setup()
    const { locked } = realStates()
    const unlock = vi.fn<OverlayActions['unlock']>()
    const actions: OverlayActions = { unlock, approve: vi.fn(), review: vi.fn(), release: vi.fn() }
    renderOverlay(asOverlayRoot(dom.window.document), host, locked, actions)

    const envelope = docOf(dom).querySelector('[data-testid="overlay-envelope"]')!
    const pass = docOf(dom).querySelector('[data-testid="overlay-passphrase"]')!
    envelope.value = 'ENVELOPE-TEXT'
    pass.value = 'MY-PASSPHRASE'
    clickEl(dom, docOf(dom).querySelector('[data-testid="overlay-unlock"]')!)

    expect(unlock).toHaveBeenCalledWith('ENVELOPE-TEXT', 'MY-PASSPHRASE')
  })

  it('unlock-failed → 错误条可见且有内容（失败绝不静默）', () => {
    const { dom, host } = setup()
    renderOverlay(
      asOverlayRoot(dom.window.document),
      host,
      { kind: 'unlock-failed', platform: 'beisen', featureCount: 9 },
      noopActions(),
    )

    const error = docOf(dom).querySelector('[data-testid="overlay-error"]')
    expect(error).not.toBeNull()
    expect(error?.textContent?.trim().length).toBeGreaterThan(0)
  })

  it('ready → 分列计数 + 每 fill 一只复选框（默认全勾）；取消一只再批准 → 只批剩下的', () => {
    const { dom, host } = setup()
    const { ready, fillKeys } = realStates()
    const approve = vi.fn<OverlayActions['approve']>()
    renderOverlay(asOverlayRoot(dom.window.document), host, ready, {
      unlock: vi.fn(),
      approve,
      review: vi.fn(),
      release: vi.fn(),
    })

    const boxes = Array.from(docOf(dom).querySelectorAll('[data-testid^="overlay-item-"] input'))
    expect(boxes.length).toBe(fillKeys.length)
    expect(boxes.every((b) => b.checked)).toBe(true)

    boxes[0]!.checked = false
    clickEl(dom, docOf(dom).querySelector('[data-testid="overlay-approve"]')!)

    expect(approve).toHaveBeenCalledTimes(1)
    const approvedKeys = approve.mock.calls[0]![0]
    expect(approvedKeys).toHaveLength(fillKeys.length - 1)
    expect(approvedKeys).toEqual(expect.arrayContaining(fillKeys.slice(1)))
  })

  it('applied → 写入计数 + 「提交前审查」按钮；点它 → actions.review()', () => {
    const { dom, host } = setup()
    const { applied } = realStates()
    const review = vi.fn<OverlayActions['review']>()
    renderOverlay(asOverlayRoot(dom.window.document), host, applied, {
      unlock: vi.fn(),
      approve: vi.fn(),
      review,
      release: vi.fn(),
    })

    expect(docOf(dom).querySelector('[data-testid="overlay-review"]')).not.toBeNull()
    clickEl(dom, docOf(dom).querySelector('[data-testid="overlay-review"]')!)
    expect(review).toHaveBeenCalledTimes(1)
  })

  it('submit-review → 放行（空决策）与放行并回填（全提案）两个出口，决策 id 与提案一致', () => {
    const { dom, host } = setup()
    const { review } = realStates()
    const release = vi.fn<OverlayActions['release']>()
    renderOverlay(asOverlayRoot(dom.window.document), host, review, {
      unlock: vi.fn(),
      approve: vi.fn(),
      review: vi.fn(),
      release,
    })

    clickEl(dom, docOf(dom).querySelector('[data-testid="overlay-release-backfill"]')!)
    expect(release).toHaveBeenCalledTimes(1)
    const decisions = release.mock.calls[0]![0]
    expect(decisions.map((d) => d.id)).toEqual(review.proposal.items.map((i) => i.id))

    release.mockClear()
    clickEl(dom, docOf(dom).querySelector('[data-testid="overlay-release"]')!)
    expect(release).toHaveBeenCalledWith([])
  })

  it('submit-released → 新信封文本在只读框里，回 Web 端粘贴是回填的落库出口', () => {
    const { dom, host } = setup()
    const { released } = realStates()
    renderOverlay(asOverlayRoot(dom.window.document), host, released, noopActions(), {
      envelopeText: 'UPDATED-ENVELOPE-TEXT',
    })

    const out = docOf(dom).querySelector('[data-testid="overlay-envelope-out"]')!
    expect(out).not.toBeNull()
    expect(out.readOnly).toBe(true)
    expect(out.value).toBe('UPDATED-ENVELOPE-TEXT')
  })

  it('extra.errorText → 红条可见（会话级失败不静默，Web 端事故的教训）', () => {
    const { dom, host } = setup()
    const { ready } = realStates()
    renderOverlay(asOverlayRoot(dom.window.document), host, ready, noopActions(), {
      errorText: '保存失败：xxx',
    })

    const error = docOf(dom).querySelector('[data-testid="overlay-session-error"]')
    expect(error).not.toBeNull()
    expect(error?.textContent).toContain('保存失败')
  })
})
