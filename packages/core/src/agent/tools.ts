/**
 * 工具白名单 —— DESIGN 9 那张表的全部实现。
 *
 * ## 白名单的价值在于「只有一个入口」
 *
 * 一个只写在文档里的白名单拦不住任何人：想绕过它，直接在循环里
 * `import` 一个别的东西就行。所以这里的做法与 `core/egress` 一致 ——
 * **收敛成唯一入口** `dispatchTool`，并让它在运行时对未知名字抛错。
 * 循环里的每一步都必须经过它，于是「调了哪些工具」这件事
 * 天然留下一份审计记录（`AgentStep[]`），可以事后核对。
 *
 * ## 五个工具的纯度
 *
 * | 工具 | 网络 | 判定依据 |
 * |---|---|---|
 * | `score_match` | 否 | 调 `core/match`（ADR-4，零 LLM） |
 * | `keyword_gap` | 否 | 纯字符串比对 |
 * | `rewrite` | **是** | 调 `core/rewrite` → 唯一出网点 `core/egress` |
 * | `verify_facts` | 否 | 调 `core/verify`（AGENTS.md 红线 6） |
 * | `ask_user` | 否 | 造一个问题，什么都不调 |
 *
 * `TOOL_SPECS` 里恰好有一个 `networked: true`，且必须是 `rewrite`。
 * 把这件事写成数据而不是注释，是为了让它成为一条断言：哪天有人
 * 给 `verify_facts` 接上一个「让模型复核一下」的补充，那一行会变红。
 *
 * ## 与 DESIGN 9 的一处语义放宽
 *
 * DESIGN 9 把 `verify_facts` 描述为「幻觉溯源：数字与实体比对原文」。
 * 这里它返回 `verifyBullets` 的完整结果（三层严重性）而不是只返回 fatal 层。
 * 理由：循环每轮要同时知道两件事 ——「有没有撒谎」（决定继续不继续）
 * 与「离目标还差多少」（决定要不要再来一轮、以及怎么向用户交代）。
 * 分两次调用同一个纯函数没有意义，而 fatal 层是完整结果的子集，
 * 语义没有被削弱。**一条工具调用，两种读数。**
 */

import { matchItems, type MatchItem, type RejectionExplanation } from '../match/index'
import { rewriteBullets, type RewriteCandidate, type RewriteReport, type StyleAnchor } from '../rewrite/index'
import type { CompiledJd } from '../compile/index'
import type { LLMClient } from '../egress/index'
import type { ArchiveV1 } from '../schema/index'
import {
  normalizeWhitespace,
  verifyBullets,
  type Bullet,
  type VerifyResult,
} from '../verify/index'
import { UnknownToolError } from './errors'
import type { AgentQuestion, ToolName, ToolSpec } from './types'

export const TOOL_SPECS: readonly ToolSpec[] = Object.freeze([
  {
    name: 'score_match',
    purpose: '调确定性匹配引擎，给出分数、分项明细与淘汰理由',
    networked: false,
  },
  {
    name: 'keyword_gap',
    purpose: '比对 JD 技能词与当前稿子，给出命中与缺口',
    networked: false,
  },
  {
    name: 'rewrite',
    purpose: '调逐条并发改写。**本层唯一的网络出口**',
    networked: true,
  },
  {
    name: 'verify_facts',
    purpose: '确定性核验：数字溯源、强动词开头、被动语态、长度、动词重复、量化率、关键词覆盖',
    networked: false,
  },
  {
    name: 'ask_user',
    purpose: '登记一个需要用户补充事实才能解决的问题',
    networked: false,
  },
])

export const TOOL_NAMES: readonly ToolName[] = Object.freeze(TOOL_SPECS.map((spec) => spec.name))

export function isWhitelisted(name: string): name is ToolName {
  return TOOL_NAMES.includes(name as ToolName)
}

/* ------------------------------------------------------------------ score_match */

export interface ScoreMatchArgs {
  readonly items: readonly MatchItem[]
  readonly jd: CompiledJd
  readonly now: string
  readonly limit: number
}

export interface ScoredEntry {
  readonly entryId: string
  readonly total: number
  readonly selected: boolean
}

export interface ScoreMatchResult {
  readonly ranked: readonly ScoredEntry[]
  /** 入选的 entryId，按分数降序 */
  readonly selectedIds: readonly string[]
  readonly cutoff: number
  readonly explanations: readonly RejectionExplanation[]
}

function runScoreMatch(args: ScoreMatchArgs): Promise<ScoreMatchResult> {
  const report = matchItems(args.items, args.jd, { now: args.now, limit: args.limit })
  return Promise.resolve({
    ranked: report.scored.map((entry) => ({
      entryId: entry.item.entryId,
      total: entry.breakdown.total,
      selected: entry.selected,
    })),
    selectedIds: report.selected.map((entry) => entry.item.entryId),
    cutoff: report.cutoff,
    explanations: report.explanations,
  })
}

/* ------------------------------------------------------------------ keyword_gap */

export interface KeywordGapArgs {
  readonly texts: readonly string[]
  readonly jd: CompiledJd
}

export interface KeywordGapResult {
  readonly hit: readonly string[]
  readonly missed: readonly string[]
  /** 0–1；JD 没有技能词时为 1（「没有要求」不等于「完全不满足」） */
  readonly coverage: number
}

/**
 * 关键词缺口。
 *
 * 用的是与 `verify/gate.ts` 的覆盖判定**同一套算法**（空白归一化 + 小写 + includes）。
 * 若这里另写一套，就会出现「工具说覆盖率 80%、闸门说 50%」这种
 * 让用户彻底不信任何数字的分歧 —— 而分歧的根源只是两处实现漂移了。
 */
function runKeywordGap(args: KeywordGapArgs): Promise<KeywordGapResult> {
  if (args.jd.skills.length === 0) {
    return Promise.resolve({ hit: [], missed: [], coverage: 1 })
  }
  const hay = normalizeWhitespace(args.texts.join(' ')).toLowerCase()
  const hit: string[] = []
  const missed: string[] = []
  for (const skill of args.jd.skills) {
    const needle = normalizeWhitespace(skill.name).toLowerCase()
    if (needle !== '' && hay.includes(needle)) hit.push(skill.name)
    else missed.push(skill.name)
  }
  return Promise.resolve({ hit, missed, coverage: hit.length / args.jd.skills.length })
}

/* ------------------------------------------------------------------ rewrite */

export interface RewriteToolArgs {
  readonly client: LLMClient
  readonly model: string
  readonly candidates: readonly RewriteCandidate[]
  readonly jd: CompiledJd
  readonly anchors?: readonly StyleAnchor[]
  readonly archive?: ArchiveV1
  readonly reference?: string
  readonly maxAttempts?: number
}

export interface RewriteToolResult {
  readonly report: RewriteReport
}

function runRewrite(args: RewriteToolArgs): Promise<RewriteToolResult> {
  return rewriteBullets({
    client: args.client,
    model: args.model,
    candidates: args.candidates,
    jd: args.jd,
    ...(args.anchors === undefined ? {} : { anchors: args.anchors }),
    ...(args.archive === undefined ? {} : { archive: args.archive }),
    ...(args.reference === undefined ? {} : { reference: args.reference }),
    ...(args.maxAttempts === undefined ? {} : { maxAttempts: args.maxAttempts }),
  }).then((report) => ({ report }))
}

/* ------------------------------------------------------------------ verify_facts */

export interface VerifyFactsArgs {
  readonly bullets: readonly Bullet[]
  /** 事实来源：未改写的原文。数字与实体只能从这些文本里来。 */
  readonly sources: readonly string[]
  readonly jd?: CompiledJd
}

export interface VerifyFactsResult {
  readonly result: VerifyResult
}

function runVerifyFacts(args: VerifyFactsArgs): Promise<VerifyFactsResult> {
  // 同步返回。一个出网调用不可能同步完成 —— 这就是 AGENTS.md 红线 6
  // 在这一层的可执行形式：验收器**没有办法**是模型。
  return Promise.resolve({
    result: verifyBullets({
      bullets: args.bullets,
      sources: args.sources,
      ...(args.jd === undefined ? {} : { jd: args.jd }),
    }),
  })
}

/* ------------------------------------------------------------------ ask_user */

export interface AskUserArgs {
  readonly bulletId: string | null
  readonly kind: AgentQuestion['kind']
  readonly prompt: string
}

export interface AskUserResult {
  readonly question: AgentQuestion
}

function runAskUser(args: AskUserArgs): Promise<AskUserResult> {
  return Promise.resolve({
    question: { bulletId: args.bulletId, kind: args.kind, prompt: args.prompt },
  })
}

/* ------------------------------------------------------------------ 分发 */

export interface ToolArgs {
  readonly score_match: ScoreMatchArgs
  readonly keyword_gap: KeywordGapArgs
  readonly rewrite: RewriteToolArgs
  readonly verify_facts: VerifyFactsArgs
  readonly ask_user: AskUserArgs
}

export interface ToolResult {
  readonly score_match: ScoreMatchResult
  readonly keyword_gap: KeywordGapResult
  readonly rewrite: RewriteToolResult
  readonly verify_facts: VerifyFactsResult
  readonly ask_user: AskUserResult
}

const IMPLEMENTATIONS: {
  [K in ToolName]: (args: ToolArgs[K]) => Promise<ToolResult[K]>
} = {
  score_match: runScoreMatch,
  keyword_gap: runKeywordGap,
  rewrite: runRewrite,
  verify_facts: runVerifyFacts,
  ask_user: runAskUser,
}

/**
 * 唯一的工具调用入口。
 *
 * 未知名字**抛错而不是返回空结果** —— 这一条是本层白名单的运行时保障：
 * 一个返回 `undefined` 的降级路径，会让「调错工具」退化成「这个工具没产出」，
 * 而后者在下游看起来只是「这轮没效果」。
 */
export function dispatchTool<K extends ToolName>(
  name: K,
  args: ToolArgs[K],
): Promise<ToolResult[K]> {
  const implementation = IMPLEMENTATIONS[name]
  if (implementation === undefined) throw new UnknownToolError(name)
  return implementation(args)
}
