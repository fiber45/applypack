/**
 * T7.2 —— 预览确认面板的纯逻辑层：面板是 T5.3（票制）、T5.5（分列）
 * 在内容脚本里的**接线板**，不发明任何新语义。
 *
 * ## 状态机即 UI 契约
 *
 * ```
 * closed ──(有表单)──→ locked ──(解锁成功)──→ ready ──(批准)──→ applied
 *                        │  └─(解锁失败)→ unlock-failed ──┘      │
 *                        └──────────(重试解锁)───────────────────┘
 * ```
 *
 * - `locked` / `unlock-failed` **结构上不携带 preview**（判别联合的分枝
 *   决定字段）—— 「档案未解锁时面板明确说先解锁，不出现半残状态」
 *   因此不是渲染纪律，是类型事实：渲染层想画半残面板都拿不到数据。
 * - `applied` 是终态：再批一次没有入口（`approveFill` 只收 ready）。
 *   要重新填就重新扫、重新预览、重新批 —— 每一步都有凭据。
 * - `ready` 携带 T5.3 的 preview（digest 绑定计划），批准即出票、
 *   出票即过门 —— 面板自己不碰 `writer.setValue`，那条路只有
 *   `applyFillPlan` 一条。
 *
 * ## 解锁为什么是接缝而不是 vault 直调
 *
 * 口令从哪来（面板输入框？独立解锁页？）是 T7.3/T7.4 的 UI 决策；
 * 本层只约定「给口令 → 给档案或 null」。真 vault（T1.5）的接线
 * 在入口胶水里是一行调用。
 */

import type { ArchiveV1 } from '../../../core/src/schema/index'
import { buildPreview, type FillItem, type FillPreview } from '../fill/preview'
import { applyFillPlan, type ApplyResult, type FillWriter } from '../fill/apply'
import { createConfirmation } from '../fill/preview'
import { buildFillPlan } from '../fill/plan'
import type { DomDocument } from '../fill/dom'
import type { PageScan } from './scan'

export type PanelState =
  | { readonly kind: 'closed' }
  | {
      readonly kind: 'locked'
      readonly platform: string | null
      readonly featureCount: number
    }
  | {
      readonly kind: 'unlock-failed'
      readonly platform: string | null
      readonly featureCount: number
    }
  | {
      readonly kind: 'ready'
      readonly platform: string | null
      /** 平台改版提示（T7.1 scanPage 的透传，T7.3 面板显示用）。 */
      readonly staleAdapter: boolean
      readonly preview: FillPreview
    }
  | {
      readonly kind: 'applied'
      readonly digest: string
      readonly result: ApplyResult
    }

/** 解锁接缝：口令进来，档案出去；口令错返回 null（不区分错误种类）。 */
export type UnlockArchive = (passphrase: string) => ArchiveV1 | null

/** 有表单 = 命中平台（哪怕 stale）或页面上提取得到任何字段。 */
function hasForm(scan: PageScan): boolean {
  return scan.platform !== null || scan.featureCount > 0
}

function buildReady(
  scan: PageScan,
  doc: DomDocument,
  archive: ArchiveV1,
): Extract<PanelState, { kind: 'ready' }> {
  const plan = buildFillPlan(doc, archive)
  return {
    kind: 'ready',
    platform: scan.platform,
    staleAdapter: scan.staleAdapter,
    preview: buildPreview(plan),
  }
}

/**
 * 面板的开合判定。archive 为 null（未解锁）时**不构建计划** ——
 * 解锁前的任何计划都是要作废的半成品，做出来只会诱惑渲染层去画它。
 */
export function openPanel(scan: PageScan, doc: DomDocument, archive: ArchiveV1 | null): PanelState {
  if (!hasForm(scan)) return { kind: 'closed' }
  if (archive === null) {
    return { kind: 'locked', platform: scan.platform, featureCount: scan.featureCount }
  }
  return buildReady(scan, doc, archive)
}

/** locked / unlock-failed → ready。成功与否由 unlock 的返回值决定，面板不猜。 */
export function unlockPanel(
  state: PanelState,
  passphrase: string,
  unlock: UnlockArchive,
  doc: DomDocument,
): PanelState {
  if (state.kind !== 'locked' && state.kind !== 'unlock-failed') {
    throw new Error(
      `unlockPanel：状态是 ${state.kind}，不在解锁流程里 —— 只有 locked / unlock-failed 能解锁`,
    )
  }
  const archive = unlock(passphrase)
  if (archive === null) {
    return {
      kind: 'unlock-failed',
      platform: state.platform,
      featureCount: state.featureCount,
    }
  }
  return buildReady(
    { platform: state.platform, pageVersion: null, adapterVersion: null, staleAdapter: false, featureCount: state.featureCount },
    doc,
    archive,
  )
}

/**
 * 批准 → 凭据 → 过门 → 写入。这条链上没有面板自己的判断：
 * 批准资格是 `createConfirmation` 的，摘要绑定是 `applyFillPlan` 的，
 * 面板只是把两者按顺序接起来。
 */
export function approveFill(
  state: PanelState,
  approvedKeys: readonly string[],
  writer: FillWriter,
): PanelState {
  if (state.kind !== 'ready') {
    throw new Error(
      `approveFill：状态是 ${state.kind}，没有可批的预览 —— 只有 ready 能批准，且 applied 是终态`,
    )
  }
  const confirmation = createConfirmation(state.preview, approvedKeys)
  const result = applyFillPlan(state.preview.plan, confirmation, writer)
  return { kind: 'applied', digest: state.preview.digest, result }
}

/**
 * T5.5 分列语义进面板：adapter 列 = 自动填（全部来自档案），
 * heuristic 列 = 启发式猜（请重点核对）。UI 高亮第二列是渲染的事，
 * 这里的契约是：两列互斥、并集恰好等于全部 fill、顺序保持页面序。
 */
export function splitPreviewColumns(preview: FillPreview): {
  readonly autoFilled: readonly FillItem[]
  readonly heuristicGuessed: readonly FillItem[]
} {
  const autoFilled: FillItem[] = []
  const heuristicGuessed: FillItem[] = []
  for (const item of preview.plan.items) {
    if (item.kind !== 'fill') continue
    if (item.source === 'adapter') autoFilled.push(item)
    else heuristicGuessed.push(item)
  }
  return { autoFilled, heuristicGuessed }
}
