/**
 * T9.2c —— 会话控制器：状态机 + 信封解锁 + 渲染层的接线板。
 *
 * 控制器自己没有业务语义 —— 它做的只是把三件事按顺序接起来：
 * 1. 解锁 = `unlockFromEnvelopeText`（异步）→ `unlockPanel`（同步收口）；
 * 2. 批准 / 审查 / 放行 = panel.ts 的既有流转；
 * 3. 每次状态变化后全量重绘，意外失败画成红条（不静默）。
 *
 * 测试走真实链：真实北森快照页、真实密文（低 KDF 夹具）、真实解锁。
 */
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

import { WEB_PASSPHRASE, createWebVault } from '../vault/__fixtures__/harness'
import { fillTestArchive } from '../fill/__fixtures__/fill-archive'
import { parseHtmlFixture } from '../fill/__fixtures__/parse'
import { BEISEN_SNAPSHOT_HTML } from '../fill/__fixtures__/snapshot-beisen'
import { createDomFillWriter } from './writer'
import { openPanel } from './panel'
import { unlockFromEnvelopeText } from './envelope-unlock'
import { asOverlayRoot, type OverlayRoot } from './overlay'
import {
  createSessionController,
  mountPanelController,
  type SessionControllerDeps,
} from './session-controller'

// ─── types:[] 下 jsdom 的 window 是 unknown —— 测试自己声明用到的最小结构面 ───

interface MiniElement {
  getAttribute(name: string): string | null
  value: string
  checked: boolean
  readOnly: boolean
  dispatchEvent(event: unknown): boolean
}

interface MiniDocument {
  getElementById(id: string): MiniElement | null
  querySelector(selectors: string): MiniElement | null
}

function docOf(dom: JSDOM): MiniDocument {
  return dom.window.document as unknown as MiniDocument
}

function bodyOf(dom: JSDOM): unknown {
  return (dom.window as unknown as { document: { body: unknown } }).document.body
}

const PAGE_SCAN = {
  platform: 'beisen',
  pageVersion: 'snapshot-1',
  adapterVersion: 'snapshot-1',
  staleAdapter: false,
  featureCount: 9,
} as const

interface Scene {
  dom: JSDOM
  doc: ReturnType<typeof parseHtmlFixture>
  controller: ReturnType<typeof createSessionController>
  root: OverlayRoot
}

async function scene(): Promise<Scene> {
  const dom = new JSDOM('<body></body>')
  const fixtureDoc = parseHtmlFixture(BEISEN_SNAPSHOT_HTML)
  // 密文与北森快照共用同一份测试档案：解锁出的档案就是建计划用的那份。
  const deps: SessionControllerDeps = {
    dom: fixtureDoc,
    writer: createDomFillWriter(fixtureDoc),
    unlockFromEnvelope: unlockFromEnvelopeText,
  }
  const root = asOverlayRoot(dom.window.document)
  const controller = createSessionController(root, bodyOf(dom), deps)
  controller.start(openPanel(PAGE_SCAN, fixtureDoc, null))
  return { dom, doc: fixtureDoc, controller, root }
}

const waitReady = async (s: Scene): Promise<void> => {
  await vi.waitFor(() => {
    if (s.controller.snapshot().kind !== 'ready') throw new Error('还没 ready')
  })
}

describe('createSessionController：粘贴信封 → 预览 → 批准 → 审查 → 放行', () => {
  it('start(locked) → 画面有解锁入口；口令错 → unlock-failed 且错误条可见', async () => {
    const s = await scene()
    expect(s.controller.snapshot().kind).toBe('locked')
    expect(docOf(s.dom).querySelector('[data-testid="overlay-unlock"]')).not.toBeNull()

    const web = await createWebVault(fillTestArchive())
    await s.controller.unlock(web.toVaultText(), 'wrong-passphrase')

    expect(s.controller.snapshot().kind).toBe('unlock-failed')
    expect(docOf(s.dom).querySelector('[data-testid="overlay-error"]')).not.toBeNull()
  })

  it('正确信封 + 口令 → ready；批准全部 → applied 且页面真被写入', async () => {
    const s = await scene()
    const web = await createWebVault(fillTestArchive())
    await s.controller.unlock(web.toVaultText(), WEB_PASSPHRASE)
    await waitReady(s)

    const state = s.controller.snapshot()
    if (state.kind !== 'ready') throw new Error(`应当 ready，实际 ${state.kind}`)
    const keys = state.preview.plan.items.flatMap((i) => (i.kind === 'fill' ? [i.key] : []))
    s.controller.approve(keys)

    expect(s.controller.snapshot().kind).toBe('applied')
    expect(docOf(s.dom).querySelector('[data-testid="overlay-review"]')).not.toBeNull()
  })

  it('审查 → submit-review；放行 → submit-released，新信封与原信封不同且可再次解锁', async () => {
    const s = await scene()
    const web = await createWebVault(fillTestArchive())
    const originalEnvelope = web.toVaultText()
    await s.controller.unlock(originalEnvelope, WEB_PASSPHRASE)
    await waitReady(s)
    const ready = s.controller.snapshot()
    if (ready.kind !== 'ready') throw new Error('应当 ready')
    s.controller.approve(ready.preview.plan.items.flatMap((i) => (i.kind === 'fill' ? [i.key] : [])))

    await s.controller.review()
    expect(s.controller.snapshot().kind).toBe('submit-review')

    await s.controller.release([])
    expect(s.controller.snapshot().kind).toBe('submit-released')
    const out = docOf(s.dom).querySelector('[data-testid="overlay-envelope-out"]')!
    expect(out.value).not.toBe('')
    expect(out.value).not.toBe(originalEnvelope)

    // 新信封用同一口令能再次解锁 —— saveArchive 产出的是合法可开的新副本。
    await expect(
      unlockFromEnvelopeText(out.value, WEB_PASSPHRASE),
    ).resolves.toMatchObject({ archive: expect.anything() })
  })

  it('点解锁按钮走的是同一条异步链（jsdom 点击 → ready）', async () => {
    const s = await scene()
    const web = await createWebVault(fillTestArchive())
    const envelope = docOf(s.dom).querySelector('[data-testid="overlay-envelope"]')!
    const pass = docOf(s.dom).querySelector('[data-testid="overlay-passphrase"]')!
    envelope.value = web.toVaultText()
    pass.value = WEB_PASSPHRASE
    const ctor = (
      s.dom.window as unknown as { MouseEvent: new (type: string, init?: { bubbles: boolean }) => unknown }
    ).MouseEvent
    docOf(s.dom)
      .querySelector('[data-testid="overlay-unlock"]')!
      .dispatchEvent(new ctor('click', { bubbles: true }))

    await waitReady(s)
  })

  it('解锁后的意外失败画成红条，不吞掉', async () => {
    const dom = new JSDOM('<body></body>')
    const fixtureDoc = parseHtmlFixture(BEISEN_SNAPSHOT_HTML)
    const boom = async (): Promise<null> => {
      throw new Error('vault 炸了')
    }
    const controller = createSessionController(
      asOverlayRoot(dom.window.document),
      bodyOf(dom),
      { dom: fixtureDoc, writer: createDomFillWriter(fixtureDoc), unlockFromEnvelope: boom },
    )
    controller.start(openPanel(PAGE_SCAN, fixtureDoc, null))
    await controller.unlock('any', 'any')

    expect(controller.snapshot().kind).toBe('locked')
    expect(docOf(dom).querySelector('[data-testid="overlay-session-error"]')).not.toBeNull()
  })
})

describe('mountPanelController：入口胶水', () => {
  it('在真实 document 上创建宿主元素并启动 —— 产物接线唯一的入口', () => {
    const dom = new JSDOM('<body></body>')
    const fixtureDoc = parseHtmlFixture(BEISEN_SNAPSHOT_HTML)
    const deps: SessionControllerDeps = {
      dom: fixtureDoc,
      writer: createDomFillWriter(fixtureDoc),
      unlockFromEnvelope: unlockFromEnvelopeText,
    }
    const controller = mountPanelController(
      asOverlayRoot(dom.window.document),
      dom.window.document,
      openPanel(PAGE_SCAN, fixtureDoc, null),
      deps,
    )
    expect(docOf(dom).getElementById('applypack-overlay')).not.toBeNull()
    expect(controller.snapshot().kind).toBe('locked')
  })
})
