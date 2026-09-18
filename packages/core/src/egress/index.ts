/**
 * `core/egress` —— 出网边界。
 *
 * **导出面即安全边界。** 这个模块对外只暴露「构造并断言」与「构造并发送」两条路径，
 * 任何新增的导出都可能是一条新的出网通道，因此在 `b-level-never-egress.test.ts`
 * 里把导出面本身写成了断言 —— 想加 `sendRaw()` 之类的东西，必须先改那一行。
 */

export { EgressLeakError } from './errors'
export { projectArchiveForLLM } from './project'
export {
  blockingLeaks,
  findBLevelPaths,
  findUndeclaredPaths,
  isStrongIdentifier,
  scanPayload,
  type Leak,
  type LeakKind,
} from './scan'
export {
  assertNoBLevelEgress,
  assembleLLMRequest,
  callLLM,
  inspectEgress,
  type AssembleOptions,
} from './request'
export type { LLMClient, LLMMessage, LLMRequest, LLMResponse, LLMRole } from './types'
