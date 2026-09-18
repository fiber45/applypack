/**
 * `core/verify` —— 确定性校验层。
 *
 * 本层有三个硬性约束，每一条都由 AGENTS.md 的红线背书：
 *
 * 1. **零 LLM 调用**（红线 6）。一个可以被模型影响的验收器，在被要求
 *    「这次就算了吧」的时候是会答应的。
 * 2. **零网络**。校验只读本地数据。
 * 3. **纯函数**。同一输入永远同一输出 —— 评测集能跑 CI 的前提。
 *
 * `gate.ts` 是 DESIGN 8.6 那张指标表的全部实现 —— 七项指标，三层严重性。
 */

export {
  DEFAULT_THRESHOLDS,
  FATAL_REASONS,
  verifyBullets,
  verifyFacts,
  type Bullet,
  type Failure,
  type FailureReason,
  type FailureSeverity,
  type VerifyInput,
  type VerifyMetrics,
  type VerifyResult,
  type VerifyThresholds,
} from './gate'
export { compareNumeric, extractNumbers, numberSet, untraceableNumbers } from './numbers'
export {
  multiViewParity,
  textsParity,
  type MultiViewParityReport,
  type ParityReport,
} from './parity'
export { isGroundedIn, normalizeWhitespace } from './trace'
export {
  hasPassiveVoice,
  isCjkDominant,
  isStrongOpening,
  leadingToken,
  weakOpener,
  EN_STRONG_VERBS,
  WEAK_OPENERS,
  ZH_STRONG_VERBS,
} from './verbs'
