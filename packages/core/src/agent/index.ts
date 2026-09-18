/**
 * `core/agent` —— 有界工具循环（DESIGN 9）。
 *
 * 这一层是把前面所有模块**接成一个能收敛的闭环**的地方：
 *
 * ```
 *   match （挑哪几段）
 *     → rewrite （怎么写）
 *       → verify （有没有撒谎、离目标多远）
 *         ↺ 带着结构化的失败回到 rewrite
 * ```
 *
 * 三个不变量，每一个都有断言守着而不是靠注释：
 *
 * 1. **工具白名单是唯一的调用入口**（`dispatchTool`，未知名字抛错），
 *    且整张表里恰好有一个工具会出网；
 * 2. **完成判定只读 `VerifyResult`**（`summarizeVerdict` 的签名里
 *    没有任何模型能影响的东西）；
 * 3. **终止有六种明确原因**，其中 `no_progress` 是「不死循环」的真正保证，
 *    轮数上限只是兜底。
 *
 * @see DESIGN 9 · TASKS.md T3.3 · AGENTS.md 红线 1 / 6
 */

export {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_NO_PROGRESS_LIMIT,
  checkRopes,
  estimateTokens,
  usageOf,
  type RopeLimits,
  type RopeState,
} from './budget'
export { UnknownToolError } from './errors'
export { runAgent } from './loop'
export {
  TOOL_NAMES,
  TOOL_SPECS,
  dispatchTool,
  isWhitelisted,
  type AskUserArgs,
  type AskUserResult,
  type KeywordGapArgs,
  type KeywordGapResult,
  type RewriteToolArgs,
  type RewriteToolResult,
  type ScoreMatchArgs,
  type ScoreMatchResult,
  type ScoredEntry,
  type ToolArgs,
  type ToolResult,
  type VerifyFactsArgs,
  type VerifyFactsResult,
} from './tools'
export type {
  AgentInput,
  AgentOptions,
  AgentOutcome,
  AgentQuestion,
  AgentStep,
  RejectedBullet,
  TerminationReason,
  ToolName,
  ToolSpec,
} from './types'
export {
  GLOBAL_ID,
  failureSignature,
  nextPending,
  summarizeVerdict,
  type Verdict,
} from './verdict'
