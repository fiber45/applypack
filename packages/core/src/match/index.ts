/**
 * `core/match` —— 匹配引擎（管线第 3 步，全程确定性，零 LLM）。
 *
 * ADR-4：LLM 编译 + 确定性匹配。这个模块回答的问题是
 * **「凭什么删我这段实习」**，而且必须给出一个用户能核对、能据以修改的答案。
 *
 * 三条不变量：
 * 1. **同输入同输出** —— 不读系统时间（`now` 必须显式传入）、不读随机数。
 * 2. **淘汰项与选中项同等可查** —— `report.scored` 含全部条目，
 *    淘汰项额外带一份 `explanation`。
 * 3. **零 LLM** —— 整个模块不 import `egress`，也就没有任何出网路径。
 *    这一点由 `match/never-calls-llm.test.ts` 的导入面断言守着。
 *
 * @see ADR-4 · DESIGN 3.3 第 3 步 · TASKS.md T2.2
 */

import type { CompiledJd } from '../compile/index'
import type { ArchiveV1 } from '../schema/index'
import { extractMatchItems } from './extract'
import {
  buildReasons,
  explainRejection,
  labelOf,
  type OvertakenBy,
  type RejectionExplanation,
} from './reasons'
import { DEFAULT_WEIGHTS, scoreItem, skillWeight, type MatchWeights, type ScoreBreakdown } from './score'
import type { MatchItem, Reason } from './types'

/** 默认入选条数。对应「一页中文简历」的量级 —— 具体页数策略属于渲染层（T4a）。 */
export const DEFAULT_LIMIT = 6

const OVERTAKEN_SAMPLE = 3

export interface MatchOptions {
  /** 参照时间，`YYYY-MM`。**必填且显式** —— 内部读系统时间会破坏可复现性。 */
  readonly now: string
  readonly limit?: number
  readonly weights?: MatchWeights
}

export interface ScoredItem {
  readonly item: MatchItem
  readonly breakdown: ScoreBreakdown
  /** 逐条理由，按影响幅度降序 */
  readonly reasons: readonly Reason[]
  readonly selected: boolean
}

export interface MatchReport {
  /** 全部条目，含被淘汰的（按分数降序） */
  readonly scored: readonly ScoredItem[]
  readonly selected: readonly ScoredItem[]
  readonly rejected: readonly ScoredItem[]
  /**
   * 入选线：**入选者中的最低分**。
   *
   * 它的定义与「有没有人被拦下」无关 —— 全部入选时它等于最后一名的分数，
   * 而不是 0。只有「一个都没入选」（`limit: 0`）时才是 0。
   * 这样它是个含义稳定的量：想问「门槛在哪」，答案永远是同一个式子。
   */
  readonly cutoff: number
  /** 每条淘汰项的「为什么删我」解释 */
  readonly explanations: readonly RejectionExplanation[]
}

export function matchItems(
  items: readonly MatchItem[],
  jd: CompiledJd,
  options: MatchOptions,
): MatchReport {
  const weights = options.weights ?? DEFAULT_WEIGHTS
  const limit = Math.max(0, Math.floor(options.limit ?? DEFAULT_LIMIT))

  const sorted = items
    .map((item) => {
      const breakdown = scoreItem(item, jd, options.now, weights)
      return {
        item,
        breakdown,
        reasons: buildReasons(item, breakdown, jd, weights, options.now),
      }
    })
    // 同分保持原始顺序：Array.prototype.sort 自 ES2019 起保证稳定，
    // 而原始顺序由 extractMatchItems 固定，于是整个报告可复现。
    .sort((a, b) => b.breakdown.total - a.breakdown.total)

  const selected: ScoredItem[] = sorted
    .slice(0, limit)
    .map((entry) => ({ ...entry, selected: true }))
  const rejected: ScoredItem[] = sorted
    .slice(limit)
    .map((entry) => ({ ...entry, selected: false }))

  const lastSelected = selected.at(-1)
  const cutoff = lastSelected === undefined ? 0 : lastSelected.breakdown.total

  // 分数最接近的入选项：selected 已降序，末尾就是最低的几个，反转即由近及远。
  const nearest: OvertakenBy[] = [...selected]
    .reverse()
    .slice(0, OVERTAKEN_SAMPLE)
    .map((entry) => ({
      entryId: entry.item.entryId,
      label: labelOf(entry.item),
      total: entry.breakdown.total,
    }))

  const explanations = rejected.map((entry) =>
    explainRejection(entry.item, entry.reasons, entry.breakdown.total, cutoff, nearest),
  )

  return { scored: [...selected, ...rejected], selected, rejected, cutoff, explanations }
}

/** 从档案直接匹配。档案在此处被抽成 `MatchItem[]`，B 级字段不进入本层。 */
export function matchArchive(
  archive: ArchiveV1,
  jd: CompiledJd,
  options: MatchOptions,
): MatchReport {
  return matchItems(extractMatchItems(archive), jd, options)
}

export { extractMatchItems }
export { explainRejection, labelOf, type OvertakenBy, type RejectionExplanation }
export { DEFAULT_WEIGHTS, scoreItem, skillWeight, type MatchWeights, type ScoreBreakdown }
export type { MatchItem, MatchKind, Reason, ReasonKind } from './types'
