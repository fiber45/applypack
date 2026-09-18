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
 * T2.1 阶段这里只有溯源所需的最小实现（数字与文本比对）；
 * T3.2 会在此之上补关键词覆盖、长度、动词重复率等指标。
 */

export { extractNumbers, numberSet, untraceableNumbers } from './numbers'
export { isGroundedIn, normalizeWhitespace } from './trace'
