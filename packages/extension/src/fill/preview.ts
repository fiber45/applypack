import type { FillPlan, FillPlanItem } from './plan'

/**
 * 预览确认 —— 「读页面」与「写页面」之间那道门的**票务系统**（TASKS T5.3）。
 *
 * DESIGN 3.4：「预览确认 UI（用户逐项确认后才写入 DOM）」。本文件交付
 * 纯逻辑层的两半：
 *
 * 1. **`buildPreview`** —— 把 `FillPlan` 加工成 UI 直接可渲染的视图：
 *    计数（DESIGN 11.4 摘要的前身）、blocking 缺口的一等公民通道
 *    （DESIGN 11.2 例外条款：「必填项在填充阶段即时提示」）、
 *    以及可批集合（只有 fill 有被批准的资格）。
 * 2. **`createConfirmation`** —— 用户确认之后产出的**凭据**。它不是
 *    一个布尔值，是一张与预览内容摘要（digest）绑定的票：计划在
 *    预览之后变过（页面变了、重算过、值差一个字符），旧票作废。
 *    「任何写入之前必须经过用户确认」因此不是一个 UI 习惯，
 *    而是类型 + 摘要双重的门（门本体在 `apply.ts`）。
 *
 * digest 是**内容寻址**的：只覆盖 fill 条目（key / path / value / 来源 /
 * 顺序）。缺口与槽位不进摘要 —— 它们本来就不可批，批的资格集合变了
 * 一定会连带动 fill 集合。摘要对顺序敏感：同样的字段换一遍页面顺序，
 * 用户看到的预览就不是同一份，票也不该通用。
 */

const DIGEST_PREFIX = 'fill-preview-v1'

export type FillItem = Extract<FillPlanItem, { kind: 'fill' }>
export type GapItem = Extract<FillPlanItem, { kind: 'gap' }>
export type FileSlotItem = Extract<FillPlanItem, { kind: 'file-slot' }>

export interface FillPreviewCounts {
  readonly fill: number
  readonly fillByAdapter: number
  readonly fillByHeuristic: number
  readonly gap: number
  readonly blockingGap: number
  readonly fileSlot: number
}

export interface FillPreview {
  /** 原计划原样带上 —— 行序即页面顺序，UI 不再各自排序。 */
  readonly plan: FillPlan
  /** 计划中 fill 条目的内容摘要（含顺序）。确认凭据与它绑定。 */
  readonly digest: string
  readonly counts: FillPreviewCounts
  /**
   * blocking 缺口（DESIGN 11.2 例外条款）：预览的第一屏就要展示，
   * 否则用户走到提交才发现要回头重填。它是 plan 的投影，不是新算的。
   */
  readonly blockingGaps: readonly GapItem[]
  readonly nonBlockingGaps: readonly GapItem[]
  /** 上传槽位（红线 5：只提示不代填）。 */
  readonly fileSlots: readonly FileSlotItem[]
  /** 有批准资格的 key —— gap / file-slot / checkbox 天生不在其中。 */
  readonly approvableKeys: readonly string[]
  readonly requiresAttention: boolean
}

/**
 * 计划中 fill 条目的确定性序列化。这是「用户确认了什么」的精确内容：
 * key / path / value / 来源 / 顺序。任何一项变化都会改变摘要。
 */
export function previewDigest(plan: FillPlan): string {
  const parts: string[] = [DIGEST_PREFIX]
  for (const item of plan.items) {
    if (item.kind !== 'fill') continue
    parts.push(`${item.key}\u0001${item.path}\u0001${item.value}\u0001${item.source}`)
  }
  return parts.join('\u0002')
}

export function buildPreview(plan: FillPlan): FillPreview {
  const fills: FillItem[] = []
  const gaps: GapItem[] = []
  const blockingGaps: GapItem[] = []
  const nonBlockingGaps: GapItem[] = []
  const fileSlots: FileSlotItem[] = []

  for (const item of plan.items) {
    if (item.kind === 'fill') {
      fills.push(item)
      continue
    }
    if (item.kind === 'gap') {
      gaps.push(item)
      if (item.blocking) blockingGaps.push(item)
      else nonBlockingGaps.push(item)
      continue
    }
    fileSlots.push(item)
  }

  return {
    plan,
    digest: previewDigest(plan),
    counts: {
      fill: fills.length,
      fillByAdapter: fills.filter((f) => f.source === 'adapter').length,
      fillByHeuristic: fills.filter((f) => f.source === 'heuristic').length,
      gap: gaps.length,
      blockingGap: blockingGaps.length,
      fileSlot: fileSlots.length,
    },
    blockingGaps,
    nonBlockingGaps,
    fileSlots,
    approvableKeys: fills.map((f) => f.key),
    requiresAttention: blockingGaps.length > 0,
  }
}

/** 凭据的品牌字段：模块私有 symbol，字面量造不出来（编译期的门）。 */
const confirmationBrand: unique symbol = Symbol('FillConfirmation')

export interface FillConfirmation {
  /** 创建凭据时所针对预览的内容摘要。 */
  readonly digest: string
  /** 用户批准的 key 集合（已归一到计划顺序、已去重）。 */
  readonly approvedKeys: readonly string[]
  readonly [confirmationBrand]: 'FillConfirmation'
}

/**
 * 把用户的批准变成凭据。合法性在创建时把关：
 * 批了没有资格的 key（gap / file-slot / 不存在的 key）在这里直接拒绝，
 * 而不是等 apply 阶段静默忽略 —— 「允许了不存在的东西」会让门变松。
 *
 * 空批准是合法的：用户看完预览一个都不批（「一个都不填」被尊重，
 * 与填错相比这是好结局）。apply 阶段将零写入。
 */
export function createConfirmation(
  preview: FillPreview,
  approvedKeys: Iterable<string>,
): FillConfirmation {
  const approvable = new Set(preview.approvableKeys)
  const seen = new Set<string>()
  for (const key of approvedKeys) {
    if (!approvable.has(key)) {
      throw new Error(
        `createConfirmation：key「${key}」没有批准资格 —— 它不是这份预览里的 fill 字段`,
      )
    }
    seen.add(key)
  }
  // 归一到计划顺序：写入顺序只认页面，UI 传什么顺序都行。
  const ordered = preview.approvableKeys.filter((key) => seen.has(key))
  return {
    digest: preview.digest,
    approvedKeys: ordered,
    [confirmationBrand]: 'FillConfirmation',
  }
}
