/**
 * 改写层的类型层。
 *
 * 这里有两处形状决策，都不是为了解耦好看。
 *
 * ## 一、`RewriteCandidate` 是窄结构，且只有一个文本字段
 *
 * 与 `match/types.ts` 的 `MatchItem` 同一个理由：送进来的东西里
 * **不存在** B 级字段，所以「改写层读不到手机号」这件事在类型上成立，
 * 而不是靠自觉（AGENTS.md 红线 1）。
 *
 * 但这里还多做了一件事：候选里**只有一个文本字段** `sourceText`，
 * 而且它的语义被钉死为「未经改写的原文」。DESIGN 8.2 说
 * 「绝不『先总结再改写』—— 原始数字一旦在预处理阶段丢失，幻觉校验就永远失效」。
 * 如果这里同时提供 `summary` 与 `sourceText` 两个字段，那么第一个偷懒的调用方
 * 就会只填 summary（它更短、更省 token、看起来信息密度更高），
 * 而溯源闸门会在**没有参照物**的情况下继续报「通过」——
 * 静默失效，且症状是「闸门好像从不拦东西」。
 * 少一个字段，是这个失效模式唯一的根治办法。
 *
 * ## 二、失败是一种返回值，不是异常
 *
 * 40 条并发改写里有一条失败，是正常工况而不是崩溃。所以本层的返回类型是
 * `RewriteReport`，它同时装着 `rewritten` 与 `failed`，并附一条可断言的恒等式：
 *
 *   rewritten.length + failed.length === candidates.length
 *
 * 「失败隔离」（TASKS.md T3.1）的可断言形式就是这条 —— 别的 39 条不受影响，
 * 而失败的那条**不会被静默丢掉**。
 *
 * @see DESIGN 8.1 / 8.2 / 8.4 / 8.5 · TASKS.md T3.1 · AGENTS.md 红线 1
 */

import type { CompiledJd } from '../compile/index'
import type { LLMClient } from '../egress/index'
import type { ArchiveV1 } from '../schema/index'
import type { ParseFailure } from '../compile/index'

/** 送进改写层的单条候选。刻意窄 —— 里面没有任何 B 级字段。 */
export interface RewriteCandidate {
  /** 稳定定位符，形如 `work.0.2`。失败清单与风格锚点都靠它指回原条目。 */
  readonly bulletId: string
  /** 所属经历条目的 id，形如 `work.0` */
  readonly entryId: string
  /** 职位 / 项目名 */
  readonly title: string
  /** 公司 / 学校 */
  readonly organization: string
  /** `YYYY-MM`，缺失为 null。格式化由调用方决定 —— 「缺失」与「写了空串」是两种含义。 */
  readonly startDate: string | null
  readonly endDate: string | null
  /**
   * **逐字保留的原始描述，未经任何改写。**
   *
   * 它同时是两件事：改写的输入，与**唯一的溯源参照物**（`verifyBullets` 的 `sources`）。
   * 这里一旦存的是摘要，整条溯源链当场断掉，而且没有任何症状。
   */
  readonly sourceText: string
  /** 匹配引擎给出的命中关键词，用于提示改写时该保留哪些词 */
  readonly keywordsHit: readonly string[]
  /** 匹配分数，供模型判断这条值不值得花力气（0–100） */
  readonly score: number
}

/**
 * 风格锚点。
 *
 * DESIGN 8.4 的副作用与解法：逐条并发会带来风格漂移，解法是
 * 「把已定稿的前 3 条作为风格锚点带进后续调用」。
 * 锚点的唯一约束是**必须已经通过闸门** —— 见 `anchors.ts`。
 */
export interface StyleAnchor {
  readonly bulletId: string
  readonly text: string
}

/** 一条改写成功且通过闸门的 bullet。 */
export interface RewrittenBullet {
  readonly bulletId: string
  readonly text: string
  /** 模型声明的依据片段。已经过逐字比对，确认是原文的一部分。 */
  readonly sourceSpan: string
  /** 模型声明的事实依据。每一条都已确认是原文的一部分。 */
  readonly evidence: readonly string[]
  /**
   * 模型自报命中的关键词。**不参与任何判定**，只作为诊断信息保留。
   *
   * 判定一律用 `matchedKeywords`（本地确定性计算）—— 一个可以自报命中率的
   * 改写器，在没人核对的时候会把命中率报得很高。这与 AGENTS.md 红线 6
   * 是同一个原则：验收标准不能由被验收者提供。
   */
  readonly declaredKeywords: readonly string[]
  /** 由本地计算的关键词命中（与 `verify` 的关键词覆盖判定同一套算法） */
  readonly matchedKeywords: readonly string[]
  /** 这一条一共调用了几次模型（1 = 一次通过） */
  readonly attempts: number
  /** 本次改写带进去的锚点 id。空数组 = 无锚点。 */
  readonly anchorsUsed: readonly string[]
}

/** 一条耗尽重试次数仍未过闸门的 bullet。 */
export interface RewriteFailureEntry {
  readonly bulletId: string
  readonly attempts: number
  readonly failure: ParseFailure
}

export interface RewriteReport {
  /** 顺序与 `candidates` 一致 —— 并发完成顺序不参入结果顺序 */
  readonly rewritten: readonly RewrittenBullet[]
  readonly failed: readonly RewriteFailureEntry[]
  /** 本次实际使用的锚点。未启用锚点时为空数组。 */
  readonly anchors: readonly StyleAnchor[]
  /** 总调用次数（含重试）。= Σ attempts */
  readonly calls: number
  /**
   * 并发峰值。
   *
   * 存在的理由：TASKS.md 说「40 条并发，总延迟 ≈ 最慢一条」。
   * 如果并发度只写在文档里，那么某天有人为了「稳一点」把它改成串行，
   * 没有任何断言会红。把它做成**可观测量**之后，
   * 「峰值并发 == 候选条数」就是一条能挂进 CI 的断言。
   */
  readonly concurrencyPeak: number
}

export interface RewriteOptions {
  readonly client: LLMClient
  readonly model: string
  readonly candidates: readonly RewriteCandidate[]
  /** 结构化 JD。省略即不加关键词约束（闸门的关键词覆盖项也会随之关闭）。 */
  readonly jd?: CompiledJd
  /**
   * 用户档案。**它只会以 A 级投影的形态进入缓存前缀**（`core/egress` 负责）。
   * 省略表示本次改写不携带档案。
   */
  readonly archive?: ArchiveV1
  /** few-shot 改写范例，极少变。落在缓存前缀里，排在档案之前。 */
  readonly reference?: string
  /** 外部锚点：来自上一轮已定稿的条目。给了它就不必分批。 */
  readonly anchors?: readonly StyleAnchor[]
  /**
   * 是否在**本轮**先跑出锚点再跑其余条目。
   *
   * 默认 `false`。默认值选这个，是因为它与 TASKS.md 的
   * 「总延迟 ≈ 最慢一条」严格不冲突：分批会把延迟变成两段之和。
   * 真实管线里锚点来自上一轮（`anchors`），本参数只服务「第一轮就要锚点」的场景。
   * 代价写清楚了再打开，而不是默认打开让人默默付两倍延迟。
   */
  readonly bootstrapAnchors?: boolean
  /** 引导批次的大小，默认 3。仅在 `bootstrapAnchors` 生效时使用。 */
  readonly anchorCount?: number
  /** 单条最大调用次数，默认与编译层一致。 */
  readonly maxAttempts?: number
}
