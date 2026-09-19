/**
 * 填充引擎 —— 内容脚本 + 适配器注册表（T5.1/T5.2，纯逻辑层）。
 *
 * 沿用 T1.5 定下的模式：**先落纯逻辑，平台接缝留最小接口**。
 * 本模块对 DOM 只读不写，输入输出都是纯数据 —— 整层在 Node 里
 * 对照保存的 HTML fixture 确定性地跑（`environment: 'node'` 不变）。
 * 真正的 MV3 内容脚本（WXT 骨架、chrome.runtime 接线、确认 UI）
 * 属 T5.3 及以后；`asDomDocument` 就是留给那个入口的转换点。
 *
 * ## 为什么这层在 extension 包，而不是 core
 *
 * 红线 1：core 的任何函数不得读取 B 级字段。而填表的全部意义
 * 就是把手机号、身份证这些 B 级值写进页面 —— 这张词汇表
 * （`FILL_CATALOG`）天生要读它们。它同时是 B 级数据**唯一合法的
 * 消费场景**（DESIGN 1.3：仅用于本地填充），读得其所。
 *
 * @see DESIGN.md 3.4 / 11.2 · AGENTS.md §5 红线 1 / 4 / 5
 */

export { asDomDocument, type DomDocument, type DomElement } from './dom'
export { extractFieldFeatures, type FieldFeature, type FieldKind, type SelectOption } from './features'
export { FILL_CATALOG, isFillableKind, type CatalogEntry, type FieldKindForFill } from './catalog'
export {
  MOCKBOARD_ADAPTER,
  detectPlatformAdapter,
  registerPlatformAdapter,
  resetPlatformAdaptersForTests,
  type PlatformAdapter,
} from './adapters'
export { BUILTIN_PLATFORM_ADAPTERS, registerBuiltinPlatformAdapters } from './platforms'
export {
  buildFillPlan,
  type FillGapReason,
  type FillPlan,
  type FillPlanItem,
} from './plan'
export {
  buildPreview,
  createConfirmation,
  type FileSlotItem,
  type FillConfirmation,
  type FillItem,
  type FillPreview,
  type FillPreviewCounts,
  type GapItem,
} from './preview'
export { applyFillPlan, type ApplyResult, type FillWriter } from './apply'
export {
  BACKFILL_PATHS,
  applyBackfill,
  buildBackfillProposal,
  detectBackfillCandidates,
  type BackfillCandidate,
  type BackfillDecision,
  type BackfillItem,
  type BackfillProposal,
  type BackfillSource,
  type BackfillTarget,
} from './backfill'
export {
  buildSubmitSummary,
  createSubmitGate,
  releaseSubmit,
  verifySubmitRelease,
  type SubmitGate,
  type SubmitRelease,
  type SubmitSummary,
} from './submit-review'
export {
  buildUploadNotices,
  classifyUploadSlot,
  type UploadSlotKind,
  type UploadSlotNotice,
} from './upload-slots'
