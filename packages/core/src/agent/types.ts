/**
 * 有界 Agent 的类型层（DESIGN 9）。
 *
 * ## 最重要的一条设计：**控制流是确定性的，模型只在 `rewrite` 里出现**
 *
 * DESIGN 9 把这一层描述为「Agent + 白名单工具 + 确定性闸门」，读起来像是
 * 「模型自己决定调哪个工具」。本项目没有那样做，理由不是保守，而是
 * **那条路线会让 DESIGN 9 自己的可测试性主张失效**：
 *
 * > 同一 `(profile, JD)` 的**通过与否**应高度一致（措辞可不同）。
 *
 * 若由模型挑工具、挑顺序、挑停不停，那么「通过与否一致」就成了对模型稳定性的
 * 祈愿，而不是一条能挂进 CI 的断言 —— 评测集（T3.4）立刻失去意义。
 * 而 DESIGN 8.4 把「判断力」明确放在了**改写**那一步，那一步本就在模型手里。
 *
 * 于是这里的结构是：
 *
 *   - 循环、优先级、终止判定 —— 代码（本目录）
 *   - 白名单里的 5 个工具 —— 纯函数 + 一个出网点（`tools.ts`）
 *   - 一次改写怎么写 —— 模型（`core/rewrite`）
 *
 * 附带收益：AGENTS.md 红线 1（不得读取 B 级字段）与红线 6（验收器不许是 LLM）
 * 从「被禁止」变成「**无法发生**」—— 白名单里不存在别的网络通道，
 * 而完成判定只读 `VerifyResult`，那个类型里没有任何模型能影响的东西。
 *
 * ## 与 DESIGN 9 措辞的一处对齐说明
 *
 * DESIGN 9 的输入是「目标页数」，本层的输入是 `maxBullets`。
 * 页数 → 条数的换算取决于版式（字号、行距、栏数），属于渲染层（T4a/T4b）。
 * 在这里接受「页数」会逼着 core 猜一个版式假设，而那个假设在 T4 一定会变。
 * 所以口径停在条数上，换算留给 T4 —— 边界写清楚，不糊过去。
 *
 * @see DESIGN 9 · TASKS.md T3.3 · AGENTS.md 红线 1 / 6
 */

import type { CompiledJd } from '../compile/index'
import type { LLMClient } from '../egress/index'
import type { MatchItem } from '../match/index'
import type { RewriteCandidate, RewriteFailureEntry, RewrittenBullet, StyleAnchor } from '../rewrite/index'
import type { ArchiveV1 } from '../schema/index'
import type { Failure, VerifyMetrics } from '../verify/index'

/**
 * 工具白名单。
 *
 * 这五个名字对应 DESIGN 9 那张表，一个不多一个不少。**新增工具必须改这一行**，
 * 而那一行会出现在 diff 里 —— 与 `egress/index.ts` 的导出面断言同一个思路：
 * 白名单的价值全在「它能被审计」，而不是「它写在文档里」。
 */
export type ToolName = 'score_match' | 'keyword_gap' | 'rewrite' | 'verify_facts' | 'ask_user'

export interface ToolSpec {
  readonly name: ToolName
  readonly purpose: string
  /**
   * 是否会发起网络请求。
   *
   * 整张表里**恰好有一个 `true`**，且必须是 `rewrite`。这不是注释，是断言：
   * 哪天有人给 `verify_facts` 接上一个「让模型判断一下」的补充，那一行会变红。
   */
  readonly networked: boolean
}

/** 循环为什么停下。每一种都必须能被用户读懂，因为它是「这版能不能用」的答案。 */
export type TerminationReason =
  /** 闸门全绿，且每个位置都有产物 */
  | 'passed'
  /** 轮数用满 */
  | 'rounds_exhausted'
  /** token 预算用满 */
  | 'budget_exhausted'
  /** 超时 */
  | 'timeout'
  /** 连续若干轮的失败签名完全一致 —— 再跑也不会变，停在这里省钱 */
  | 'no_progress'
  /** 剩下的问题不是模型能解决的，需要用户补充事实 */
  | 'needs_user'

export interface AgentQuestion {
  /** 关联的 bullet；无法定位时为 null（例如「JD 要的关键词你在档案里一个都没写」） */
  readonly bulletId: string | null
  readonly kind: 'unfixable_by_model' | 'missing_fact'
  /** 直接展示给用户的一句话。不写「请补充信息」这种等于没说的话。 */
  readonly prompt: string
}

/** 没进这一版的条目，以及为什么。淘汰项与选中项同等可查（ADR-4 的要求）。 */
export interface RejectedBullet {
  readonly bulletId: string
  readonly entryId: string
  /** 一句话总结，可直接展示 */
  readonly summary: string
  /** 匹配引擎给出的失分理由行（没有匹配信息时为空） */
  readonly detail: readonly string[]
}

/** 每一步工具调用的审计记录。它让「白名单」这件事可以被事后核对。 */
export interface AgentStep {
  readonly round: number
  readonly tool: ToolName
  readonly detail: string
}

export interface AgentInput {
  readonly jd: CompiledJd
  /**
   * 待改写的候选条目。
   *
   * 它们是**已经按 bullet 切好**的：切分需要逐字保留的原文（DESIGN 8.2），
   * 而那件事只能由持有原始素材的一方做 —— 在 core 里对一段经历做「智能切句」
   * 会用到一个我们无法为用户负责的启发式。切分由编译层（T2.1）的产物给出。
   */
  readonly candidates: readonly RewriteCandidate[]
  /** 供 `score_match` 排序与生成淘汰解释。省略时按 `candidates` 的给定顺序取前 `maxBullets` 条。 */
  readonly items?: readonly MatchItem[]
  /** 目标条数上限。页数 → 条数的换算属于渲染层。 */
  readonly maxBullets: number
}

export interface AgentOptions {
  readonly client: LLMClient
  readonly model: string
  /**
   * 参照时间，`YYYY-MM`。**必填且显式** —— 匹配引擎不读系统时间，
   * 因为那会破坏「同输入同输出」，而评测集靠这一条才能跑 CI。
   */
  readonly now: string
  /** 用户档案。它只会以 A 级投影的形态出网（由 `core/egress` 收口）。 */
  readonly archive?: ArchiveV1
  /** few-shot 范例，落在缓存前缀里 */
  readonly reference?: string
  /** 外部风格锚点（上一轮或用户已定稿的条目）。给了它就从第一轮起就带上。 */
  readonly anchors?: readonly StyleAnchor[]
  /** 轮数上限。DESIGN 9 写的默认 6。 */
  readonly maxRounds?: number
  /** 单条 bullet 在一次改写里最多调用几次模型 */
  readonly maxAttemptsPerBullet?: number
  /** 连续多少轮失败签名不变就判「不会再有进展」。默认 1（两次同样的失败就停）。 */
  readonly noProgressLimit?: number
  /** token 预算上限。不传即不设限。 */
  readonly tokenBudget?: number
  /** 墙钟上限（毫秒）。不传即不设限。 */
  readonly timeoutMs?: number
  /** token 估算函数。默认按「汉字 1 token，其余 4 字符 1 token」估。 */
  readonly estimateTokens?: (text: string) => number
  /**
   * 毫秒时钟。默认读 `Date.now`。
   *
   * 这是整个 core 里唯一读时间的地方，而且**只服务超时这根绳子** ——
   * 它不参与任何内容判定，因此不影响「同输入同输出」：两个都没超时的运行，
   * 结果完全一致。测试注入一个假时钟即可让超时行为也可复现。
   */
  readonly clock?: () => number
}

export interface AgentOutcome {
  readonly status: 'passed' | 'unfinished'
  readonly termination: TerminationReason
  /** 定稿的 bullet，顺序与入选顺序一致 */
  readonly bullets: readonly RewrittenBullet[]
  /** 落选的条目及原因 */
  readonly rejected: readonly RejectedBullet[]
  /** 剩余的 fatal / hard 失败。空数组才配 `status: 'passed'`。 */
  readonly failures: readonly Failure[]
  /**
   * 改写层**自己**判定失败的条目：耗尽重试次数仍未过闸门，附最后一次的原因。
   *
   * 与 `failures` 是两件事，不能合并：
   *   - `failures` 是「产出了，但违反闸门」——有稿子，稿子不对；
   *   - `unfixable` 是「根本没产出」——连稿子都没有，原因在改写层内部。
   *
   * 只报「3 条未通过」而不说是哪一条、因为什么，用户拿到的就是一个
   * 无法行动的数字。所以这条字段承载的是**最后一次的具体失败对象**
   * （`[number_not_in_source] 违规内容「40」…`），它同时被用来生成追问文案。
   */
  readonly unfixable: readonly RewriteFailureEntry[]
  /**
   * 目标层指标（量化率 / 关键词覆盖 / 动词重复）。
   *
   * 它们**不参与** `status` 的判定 —— 闸门的用途是「有没有撒谎」，不是「写得好不好」。
   * 它们是这一版离「好」还差多少的说明，供 UI 展示与下一轮参考。
   */
  readonly metrics: VerifyMetrics
  readonly questions: readonly AgentQuestion[]
  /** 实际跑了几轮 */
  readonly rounds: number
  /** 模型调用总次数（含工具内部的逐条重试） */
  readonly calls: number
  readonly spentTokens: number
  /** 每步工具调用的审计记录 */
  readonly log: readonly AgentStep[]
}
