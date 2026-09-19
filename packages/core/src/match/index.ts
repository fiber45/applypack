/**
 * `core/match` —— 匹配引擎（管线第 3 步，全程确定性，零 LLM）。
 *
 * ADR-4：LLM 编译 + 确定性匹配。这个模块回答的问题是
 * **「凭什么删我这段实习」**，而且必须给出一个用户能核对、能据以修改的答案。
 *
 * 三条不变量：
 * 1. **同输入同输出** —— 不读系统时间（`now` 必须显式传入）、不读随机数。
 * 2. **淘汰项与选中项同等可查** —— `report.scored` 含全部条目，
 *    淘汰项在**条目本身上**额外带一份 `rejection`（`ScoredItem.rejection`），
 *    不是另开一张按 id 对齐的表。见 `ScoredItem.rejection` 的注释：
 *    首版实现的平行数组让这条不变量变成了「消费方得记得 join」，
 *    而忘记 join 是静默的。界面用的视图模型见 `report.ts`。
 * 3. **零 LLM** —— 整个模块不 import `egress`，也就没有任何出网路径。
 *    这一点由 `match/never-calls-llm.test.ts` 的导入面断言守着。
 *
 * @see ADR-4 · DESIGN 3.3 第 3 步 · TASKS.md T2.2 / T2.3
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
  /**
   * 「为什么删我」。**挂在条目上，不是另开一张按 `entryId` 对齐的表。**
   *
   * 这是本文件相对首版的一处修正。首版把解释放在顶层平行数组
   * `MatchReport.explanations` 里，于是「淘汰项与选中项同等可查」这条不变量
   * 变成了一句**需要消费方配合**的话：任何遍历 `scored` 的代码，都必须
   * 记得再按 id 去 join 一次那张表，忘了不会报错 —— 它只会让淘汰行看起来
   * 信息更少，而「看起来信息更少」是可读的、不报错的、也没有测试会红的。
   *
   * 模块头原本写的就是「`report.scored` 含全部条目，淘汰项额外带一份
   * `explanation`」—— 是**实现**偏离了文档，这里把实现改回文档那一边。
   *
   *   选中项：`null`
   *   淘汰项：`RejectionExplanation`
   *
   * `MatchReport.explanations` 保留为一个**由这里投影出来**的便利数组
   * （T2.2 的断言与 `agent/` 的消费方都在用），但它不再是第二份真相：
   * 有一条断言钉住「两者恒一致」，所以从条目上读与从数组里读必然相同。
   */
  readonly rejection: RejectionExplanation | null
}

export interface MatchReport {
  /** 全部条目，含被淘汰的（按分数降序）。**即 `selected ++ rejected`。** */
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
  /**
   * 本次打分实际用的权重。**必须随报告一起返回。**
   *
   * 分数构成是 `raw × weight × 100`，所以「构成」只有在知道权重时才算得出来。
   * 不把它放进报告，消费方就只能去猜「用户传了自定义权重没有」—— 猜错的表现是
   * 报告上的四行数字加起来**恰好不等于总分**，而它会看起来像四舍五入误差。
   * 让报告自带权重，这个猜测不存在。
   */
  readonly weights: MatchWeights
  /**
   * 每条淘汰项的解释，**顺序与 `rejected` 一一对应**。
   *
   * 便利投影，不是第二份真相 —— 内容恒等于 `rejected.map((entry) => entry.rejection)`。
   * 新增消费方请直接读 `ScoredItem.rejection`；这个数组留着是为了
   * 「只要淘汰项」这种取法不必再写一次 filter。
   */
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
    .map((entry) => ({ ...entry, selected: true, rejection: null }))

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

  const rejected: ScoredItem[] = sorted.slice(limit).map((entry) => ({
    ...entry,
    selected: false,
    rejection: explainRejection(
      entry.item,
      entry.reasons,
      entry.breakdown.total,
      cutoff,
      nearest,
    ),
  }))

  return {
    scored: [...selected, ...rejected],
    selected,
    rejected,
    cutoff,
    weights,
    explanations: rejected.flatMap((entry) => (entry.rejection === null ? [] : [entry.rejection])),
  }
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
// T2.3：界面直接渲染的视图模型。刻意放在 `core` 而不是 `web` ——
// 「四项构成相加恒等于总分」是一条**算术**不变量，它该在零 DOM 的环境里被验证，
// `web` 那边只负责验「界面有没有把已有信息藏起来」。分工见 `report.ts` 文件头。
export {
  apportionToTenths,
  buildReportView,
  DIMENSION_HINT,
  DIMENSION_LABEL,
  REPORT_DIMENSIONS,
  type CompositionRow,
  type MatchReportRow,
  type MatchReportView,
  type RejectedReportRow,
  type ReportDimension,
  type SelectedReportRow,
} from './report'
