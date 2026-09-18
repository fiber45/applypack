/**
 * 完成判定 —— 一个**纯函数**，输入只有 `VerifyResult` 与两个 id 集合。
 *
 * ## 这是 AGENTS.md 红线 6 在本层的落地方式
 *
 * DESIGN 9 说：「唯一的完成判定是闸门，**验收器不许是 LLM** ——
 * 这是防止『两个 LLM 互相吹捧』的唯一办法」。
 *
 * 把判定写成这个签名之后，这件事就不再是一句纪律：
 *
 * ```
 * summarizeVerdict(result: VerifyResult, expectedIds, producedIds): Verdict
 * ```
 *
 * 参数里没有任何模型能影响的东西。想在判定里加入「模型的自我评价」，
 * 必须先往 `VerifyResult` 里塞一个字段，而 `VerifyResult` 由 `core/verify` 产出、
 * 那个模块不 import `core/egress` —— 三个模块之间形成了一个
 * **绕不过去的结构**，而不是一条需要记住的规则。
 *
 * ## 两种「没通过」必须分开
 *
 *   - `blocking`：产出了，但违反了闸门（编造数字、弱动词、超长、被动语态…）
 *   - `unresolved`：根本没产出（模型三次都没给出合规 JSON）
 *
 * 合成一个数字（「未通过项数」）会丢掉处置差别：前者要改，后者要重试或问用户。
 * 更糟的是零产出的边界 —— 零条 bullet 时 `verifyBullets` 的 `pass` 是 `true`
 * （没有条目就没有违规），于是「一条都没生成」会被报成「通过」。
 * 分开记就堵住了这个洞。
 */

import type { Failure, VerifyResult } from '../verify/index'

/** 全局性指标的占位 id。它们全是 `target` 层，因此不会出现在 `blocking` 里。 */
export const GLOBAL_ID = '<全局>'

export interface Verdict {
  /** 唯一配得上「通过」的条件：没有 blocking，也没有 unresolved */
  readonly pass: boolean
  /** fatal / hard 层的失败。**每一条的 `bulletId` 都是一个真实条目**（见下方断言）。 */
  readonly blocking: readonly Failure[]
  /** 没有产出产物的位置，按 `expectedIds` 顺序 */
  readonly unresolved: readonly string[]
  /** 失败签名，用于「还会不会有进展」的判定 */
  readonly signature: string
}

/**
 * 失败签名。
 *
 * **只看「哪一条、违反了哪条规则」，不看具体违规内容。**
 *
 * 这是刻意的：如果签名里带上 `offending`，那么「这一轮编了 40，下一轮编了 50」
 * 就会被算作一次进展 —— 而它显然不是。规则没被修好，换一个数字再编一次
 * 不该换来更多轮次。要让模型有多试几次的机会，该动的是
 * `noProgressLimit`，而不是把这个签名写松。
 */
export function failureSignature(
  blocking: readonly Failure[],
  unresolved: readonly string[],
): string {
  const parts = [
    ...blocking.map((failure) => `${failure.bulletId}:${failure.reason}`),
    ...unresolved.map((bulletId) => `${bulletId}:no_output`),
  ]
  return parts.slice().sort().join('|')
}

export function summarizeVerdict(
  result: VerifyResult,
  expectedIds: readonly string[],
  producedIds: readonly string[],
): Verdict {
  const blocking = result.failures.filter((failure) => failure.severity !== 'target')
  const produced = new Set(producedIds)
  const unresolved = expectedIds.filter((bulletId) => !produced.has(bulletId))

  return {
    pass: blocking.length === 0 && unresolved.length === 0,
    blocking,
    unresolved,
    signature: failureSignature(blocking, unresolved),
  }
}

/**
 * 下一轮该重做哪些位置。
 *
 * = 没产出的 ∪ 违反闸门的。全局性失败（`<全局>`）不指向任何条目，
 * 因此不进入这个集合 —— 它们全是 `target` 层，本来也不参与判定。
 * 想确认这一点不靠「读一遍 gate.ts 的严重性表」，靠
 * `tools.test.ts` 里那条「hard/fatal 的 bulletId 一律不是占位符」的断言。
 */
export function nextPending(verdict: Verdict): readonly string[] {
  const ids = new Set<string>(verdict.unresolved)
  for (const failure of verdict.blocking) {
    if (failure.bulletId !== GLOBAL_ID) ids.add(failure.bulletId)
  }
  return [...ids].sort()
}
