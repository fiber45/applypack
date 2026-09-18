/**
 * `core/rewrite` —— 管线的第 4 步：逐条并发改写。
 *
 * 本层是**模型的第二次出场**（第一次是编译层），也是整条链路里唯一
 * 「模型写、机器判」的地方。三件事决定了它能不能收敛：
 *
 * 1. 上下文顺序（DESIGN 8.1）—— 由 `core/egress` 的 `LLMRequest` 形状保证，
 *    本层没有能力摆错；
 * 2. 每条带**未经改写的原文**（DESIGN 8.2）—— 由 `RewriteCandidate` 只有一个
 *    文本字段保证；
 * 3. 失败反馈的结构化粒度（DESIGN 8.5）—— 由 `checkCandidate` 产出的
 *    `ParseFailure` 保证：里面是 `[number_not_in_source] 违规内容「40」`，
 *    不是「写得不够好」。
 *
 * 本层**不做**全局指标（量化率、关键词覆盖、动词重复）—— 它们只有在全部
 * 定稿之后才有意义，属于调用方（T3.3 的 Agent 循环）在拿到整份稿子后
 * 调 `verifyBullets` 一次。分工线：**本层保证单条诚实，全局只保证不撒谎。**
 */

export { DEFAULT_ANCHOR_COUNT, anchorIds, selectAnchors } from './anchors'
export {
  buildBulletTask,
  buildJdMessage,
  buildRetryMessage,
  renderAnchorBlock,
  REWRITE_SYSTEM_PROMPT,
} from './prompt'
export { rewriteBullets } from './rewrite'
export { checkCandidate, matchedKeywordsOf, rewriteOne, type CallCounter, type RewriteContext } from './runner'
export { rewriteOutputSchema, type RewriteOutput } from './schema'
export type {
  RewriteCandidate,
  RewriteFailureEntry,
  RewriteOptions,
  RewriteReport,
  RewrittenBullet,
  StyleAnchor,
} from './types'
