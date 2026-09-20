/**
 * T9.2c —— 会话控制器：状态机、信封解锁、渲染层三者的接线板。
 *
 * ## 它没有自己的业务语义
 *
 * 每一步流转都是既有部件的既有函数（panel.ts / envelope-unlock.ts /
 * glue.ts），控制器只负责：
 * - 持有「当前状态」与「当前解锁出的 vault」（后者是 submit-released
 *   之后 `toVaultText` 的数据源 —— 状态机的判别联合不装它）；
 * - 把异步解锁收口成状态机要的同步接缝（先 await 出档案或 null，
 *   再把「已经知道的结果」包成同步闭包递给 `unlockPanel`）；
 * - 每次状态变化全量重绘；意外失败画成红条 —— **绝不静默**（Web 端
 *   2026-09 事故的直接教训：吞掉的拒绝 = 「点了没反应」）。
 *
 * ## 回填的落库出口是「复制新信封」
 *
 * 扩展零权限、无存储：放行后的档案 `saveArchive` 进的是本页内存的
 * vault。它回 Web 端的唯一通道就是把 `toVaultText()` 产出的新信封
 * 复制走 —— 渲染层把新信封画成只读文本框，粘贴是用户的手，权限是零。
 */
import type { BackfillDecision } from '../fill/backfill'
import type { DomDocument } from '../fill/dom'
import type { FillWriter } from '../fill/apply'
import type { ArchiveV1 } from '../../../core/src/schema/index'
import { readPageValues } from './writer'
import { persistArchiveAfterRelease } from './glue'
import type { Vault } from '../../../core/src/vault/index'
import {
  approveFill,
  openSubmitReview,
  releaseSubmitFlow,
  unlockPanel,
  type PanelState,
} from './panel'
import {
  asOverlayRoot,
  renderOverlay,
  type OverlayActions,
  type OverlayExtra,
} from './overlay'

export interface EnvelopeUnlockFn {
  (text: string, passphrase: string): Promise<
    { readonly archive: ArchiveV1; readonly vault: Vault } | null
  >
}

export interface SessionControllerDeps {
  /** 填充引擎的 DOM 视角（与渲染层各自的接口互不相干）。 */
  readonly dom: DomDocument
  readonly writer: FillWriter
  readonly unlockFromEnvelope: EnvelopeUnlockFn
}

export interface SessionController {
  /** 画第一帧（通常是 boot 时的 locked）。 */
  start(initial: PanelState): void
  unlock(envelopeText: string, passphrase: string): Promise<void>
  approve(keys: readonly string[]): void
  review(): Promise<void>
  release(decisions: readonly BackfillDecision[]): Promise<void>
  snapshot(): PanelState
}

function asOverlayBody(candidate: unknown): { appendChild(child: unknown): unknown } {
  const body = candidate as { appendChild?: unknown }
  if (typeof candidate !== 'object' || candidate === null || typeof body.appendChild !== 'function') {
    throw new TypeError('asOverlayBody：入参缺少 appendChild，不是 body 形状')
  }
  return candidate as { appendChild(child: unknown): unknown }
}

export function createSessionController(
  rootCandidate: unknown,
  hostCandidate: unknown,
  deps: SessionControllerDeps,
): SessionController {
  const root = asOverlayRoot(rootCandidate)
  const body = asOverlayBody(hostCandidate)

  // 宿主元素由控制器自建：入口不关心面板挂在哪。
  const host = root.createElement('div')
  host.setAttribute('id', 'applypack-overlay')
  body.appendChild(host)

  let state: PanelState = { kind: 'closed' }
  let vault: Vault | null = null
  let errorText: string | undefined

  const draw = (): void => {
    // exactOptionalPropertyTypes：undefined 不许显式进对象 —— 逐项展开。
    let extra: OverlayExtra = {}
    if (errorText !== undefined) extra = { ...extra, errorText }
    if (state.kind === 'submit-released' && vault !== null) {
      extra = { ...extra, envelopeText: vault.toVaultText() }
    }
    renderOverlay(root, host, state, actions, extra)
  }

  const actions: OverlayActions = {
    unlock(envelopeText: string, passphrase: string): void {
      void controller.unlock(envelopeText, passphrase)
    },
    approve(keys: readonly string[]): void {
      controller.approve(keys)
    },
    review(): void {
      void controller.review()
    },
    release(decisions: readonly BackfillDecision[]): void {
      void controller.release(decisions)
    },
  }

  const controller: SessionController = {
    start(initial: PanelState): void {
      state = initial
      errorText = undefined
      draw()
    },

    async unlock(envelopeText: string, passphrase: string): Promise<void> {
      errorText = undefined
      let vaultResult: Awaited<ReturnType<EnvelopeUnlockFn>> = null
      try {
        vaultResult = await deps.unlockFromEnvelope(envelopeText, passphrase)
      } catch (cause) {
        // unlockFromEnvelopeText 的契约是「不抛」；真抛了（依赖缺失等）
        // 也按解锁失败画出来 —— 静默的代价已经被 Web 端付过一次。
        errorText = `解锁失败：${cause instanceof Error ? cause.message : String(cause)}`
        draw()
        return
      }
      // 同步收口：unlockPanel 要的是同步接缝，而真相已经 resolve 完毕 ——
      // 闭包只负责把它原样递过去，不做任何新判断。
      state = unlockPanel(state, passphrase, () => vaultResult?.archive ?? null, deps.dom)
      vault = vaultResult?.vault ?? null
      draw()
    },

    approve(keys: readonly string[]): void {
      errorText = undefined
      try {
        state = approveFill(state, keys, deps.writer)
      } catch (cause) {
        errorText = `批准失败：${cause instanceof Error ? cause.message : String(cause)}`
      }
      draw()
    },

    async review(): Promise<void> {
      errorText = undefined
      try {
        if (vault === null) {
          throw new Error('会话里没有解锁的 vault —— 提交审查需要档案做回填提案的基线')
        }
        state = openSubmitReview(state, await vault.loadArchive(), readPageValues(deps.dom))
      } catch (cause) {
        errorText = `审查失败：${cause instanceof Error ? cause.message : String(cause)}`
      }
      draw()
    },

    async release(decisions: readonly BackfillDecision[]): Promise<void> {
      errorText = undefined
      try {
        const released = releaseSubmitFlow(state, decisions)
        // saveArchive 进的是本页内存 vault（零权限承诺下的落库出口是
        // 「复制新信封」）—— 失败上抛成红条，不静默。
        await persistArchiveAfterRelease(released, (archive) => {
          if (vault === null) throw new Error('会话里没有解锁的 vault，无法保存')
          return vault.saveArchive(archive)
        })
        state = released
      } catch (cause) {
        errorText = `放行失败：${cause instanceof Error ? cause.message : String(cause)}`
      }
      draw()
    },

    snapshot(): PanelState {
      return state
    },
  }

  return controller
}

/**
 * 入口胶水的唯一入口：在真实 document 上建面板宿主、建控制器、画首帧。
 * scan 在 boot 里已经做完 —— 这里只消费它产出的初始面板状态。
 */
export function mountPanelController(
  rootCandidate: unknown,
  docCandidate: unknown,
  initial: PanelState,
  deps: SessionControllerDeps,
): SessionController {
  const root = asOverlayRoot(rootCandidate)
  const doc = docCandidate as { body?: unknown }
  const controller = createSessionController(root, doc.body, deps)
  controller.start(initial)
  return controller
}
