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
import { buildPreview, createConfirmation, type FillItem, type FillPreview } from '../fill/preview'
import { applyFillPlan, type ApplyResult, type FillWriter } from '../fill/apply'
import {
  buildSubmitSummary,
  createSubmitGate,
  releaseSubmit,
  verifySubmitRelease,
  type SubmitGate,
  type SubmitRelease,
  type SubmitSummary,
} from '../fill/submit-review'
import {
  applyBackfill,
  buildBackfillProposal,
  detectBackfillCandidates,
  type BackfillDecision,
  type BackfillProposal,
} from '../fill/backfill'
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
      /** 原预览 —— T7.3 提交拦截时摘要与回填检测都从这里取口径。 */
      readonly preview: FillPreview
    }
  | {
      readonly kind: 'submit-review'
      readonly summary: SubmitSummary
      readonly proposal: BackfillProposal
      readonly gate: SubmitGate
      /** 拦截时刻的档案 —— releaseSubmitFlow 在它之上应用回填决策。 */
      readonly archive: ArchiveV1
    }
  | {
      readonly kind: 'submit-released'
      readonly release: SubmitRelease
      /** 回填决策应用后的档案（空决策 = 与拦截时刻逐字节一致）。 */
      readonly archiveAfter: ArchiveV1
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
  return { kind: 'applied', digest: state.preview.digest, result, preview: state.preview }
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

/**
 * T7.3 —— 用户去点页面自己的提交按钮的那一刻（DESIGN 第 7 节第七句话）。
 *
 * 拦截一次做完三件事，全部是既有部件的接线，不发明新语义：
 * 1. 摘要 = `buildSubmitSummary(原预览)`（T5.5 分列 + emptyRequired 投影）；
 * 2. 提案 = `detectBackfillCandidates(计划, 提交时刻表单值)` →
 *    `buildBackfillProposal(候选, 档案)`（T5.6，outbid/ambiguous 永不进）；
 * 3. 门 = `createSubmitGate(摘要)`（T5.5：创建即拦截，放行一次性）。
 *
 * 只有 `applied` 能拦截 —— 没写完就拦截是半成品流程。拦截携带拦截
 * 时刻的档案：releaseSubmitFlow 在它之上应用决策，档案若在拦截后被
 * 改过，`applyBackfill` 的指纹校验会把整次放行炸回去。
 */
export function openSubmitReview(
  state: PanelState,
  archive: ArchiveV1,
  pageValues: Readonly<Record<string, string>>,
): PanelState {
  if (state.kind !== 'applied') {
    throw new Error(
      `openSubmitReview：状态是 ${state.kind} —— 只有填完（applied）才有提交可拦`,
    )
  }
  const summary = buildSubmitSummary(state.preview)
  const candidates = detectBackfillCandidates(state.preview.plan, pageValues)
  const proposal = buildBackfillProposal(candidates, archive)
  return {
    kind: 'submit-review',
    summary,
    proposal,
    gate: createSubmitGate(summary),
    archive,
  }
}

/**
 * 放行 + 回填决策，一次点击一并交给流程。
 *
 * - **放行一次性**：第二次调用在 `releaseSubmit` 里炸（T5.5 的钉）；
 * - **决策与提案不配套就拒绝**（T5.6 的钉），不静默忽略；
 * - **空决策 = 档案逐字节不变**：不静默保存，冲突保留原值；
 * - 凭据在流程内走完验收仪式（`verifySubmitRelease`）—— 放行的
 *   拿出来的票当场验真，而不是留给下游半信半疑。
 *
 * 产出 `submit-released`：`archiveAfter` 是回填后的档案，保存
 * （vault.saveArchive）是入口胶水的事 —— 状态机不知道密文的存在。
 */
export function releaseSubmitFlow(
  state: PanelState,
  decisions: readonly BackfillDecision[],
): PanelState {
  if (state.kind !== 'submit-review') {
    throw new Error(
      `releaseSubmitFlow：状态是 ${state.kind} —— 只有 submit-review 能放行，且只有一次`,
    )
  }
  const release = releaseSubmit(state.gate)
  verifySubmitRelease(release, state.summary)
  const archiveAfter = applyBackfill(state.archive, state.proposal, decisions)
  return { kind: 'submit-released', release, archiveAfter }
}
