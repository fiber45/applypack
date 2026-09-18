/**
 * 匹配引擎的类型层。
 *
 * **这里最重要的一个设计是 `MatchItem` 的形状。**
 *
 * 匹配引擎接受的不是 `ArchiveV1`，而是一组 `MatchItem` —— 一个只含
 * 标题、机构、时间与文本片段的窄结构。这不是为了解耦好看，是为了让
 * 「匹配层读不到 B 级字段」这件事**在类型上成立**，而不是靠自觉：
 *
 *   - 传 `ArchiveV1` 进来，函数体里写 `archive.basics.contact.phone`
 *     只需要一行，而 review 未必看得见；
 *   - 传 `MatchItem[]` 进来，那个字段**根本不存在**。
 *
 * AGENTS.md 红线 1 说「core 中任何函数不得读取 B 级字段」。把这句话
 * 变成类型的形状约束，是本项目唯一能长期有效的执行方式。
 *
 * @see DESIGN 3.3 第 3 步 · ADR-4 · AGENTS.md 红线 1
 */

export type MatchKind = 'work' | 'project' | 'education' | 'award' | 'certificate'

export interface MatchItem {
  /** 稳定定位符，形如 `work.0`。理由与淘汰解释都靠它指回原条目。 */
  readonly entryId: string
  readonly kind: MatchKind
  readonly title: string
  readonly organization: string
  /** `YYYY-MM`，缺失为 null */
  readonly startDate: string | null
  readonly endDate: string | null
  /** 参与关键词匹配的全部文本（标题、机构、摘要、要点、技能词） */
  readonly texts: readonly string[]
  /** 要点条数 */
  readonly highlightCount: number
  /** 含数字的要点条数。量化率 = 它 / 要点条数 */
  readonly quantifiedCount: number
}

/** 理由的种类。每一种都对应一个**可核对的事实**，没有「整体印象」这类东西。 */
export type ReasonKind =
  | 'keyword_hit'
  | 'keyword_missed'
  | 'recency'
  | 'quantification'
  | 'depth'

export interface Reason {
  readonly kind: ReasonKind
  /** 一句话说明，直接给用户看 */
  readonly label: string
  /**
   * 对总分的贡献，单位与总分一致（0–100）。
   * 正数是加分，负数是失分。用户看的不是「好 / 一般」，是「这一项让我少了 12.3 分」。
   */
  readonly impact: number
}
