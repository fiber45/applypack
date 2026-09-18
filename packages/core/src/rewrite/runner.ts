/**
 * 单条改写的尝试循环 —— 与 `compile/runner.ts` 同构，但闸门不同。
 *
 * ## 二值契约
 *
 * `compile/runner.ts` 的契约是「通过 schema 的对象 ←→ CompileError」。
 * 这里多一道：**还要通过确定性闸门**。所以单条的契约是：
 *
 *   通过 schema **且** 通过 `verifyBullets`  ←→  RewriteFailureEntry
 *
 * 没有「先收下、待会儿再说」的中间态。一稿带着编造的数字往下走，
 * 后果比一次失败严重得多：它会被渲染进简历、被用户投出去。
 *
 * ## 为什么闸门的 `target` 层不进重试提示
 *
 * `verifyBullets` 把失败分成三层（见 `verify/gate.ts`）。其中 `target`
 * 层（量化率 / 关键词覆盖）**不算失败**，但会出现在 `failures` 里。
 *
 * 本层刻意把它们从重试提示里滤掉。理由：一次重试的触发原因必须唯一。
 * 如果重试提示里同时写着「数字 40 是编的」和「量化率只有 0%」，
 * 模型去修量化率的最省事办法就是**再编一个数字** —— 而它本来就是被叫来
 * 修「编数字」这个问题的。信号混在一起，会把一次一修就好的错误
 * 变成一次引来更严重错误的修改。
 *
 * `target` 层是 T3.3 Agent 循环的目标函数，不是本层的重试理由。
 *
 * @see DESIGN 8.5 · verify/gate.ts 的三层严重性
 */

import { parseStructured, type CompiledJd, type ParseFailure } from '../compile/index'
import { callLLM, type LLMClient, type LLMMessage } from '../egress/index'
import type { ArchiveV1 } from '../schema/index'
import { isGroundedIn, normalizeWhitespace, verifyBullets } from '../verify/index'
import { buildBulletTask, buildJdMessage, buildRetryMessage, REWRITE_SYSTEM_PROMPT } from './prompt'
import { rewriteOutputSchema, type RewriteOutput } from './schema'
import type { RewriteCandidate, RewriteFailureEntry, RewrittenBullet, StyleAnchor } from './types'

/** 调用计数：`calls` 是可核对的总量，`peak` 是 TASKS.md 那条并发声明的可观测量。 */
export interface CallCounter {
  calls: number
  inFlight: number
  peak: number
}

export function createCounter(): CallCounter {
  return { calls: 0, inFlight: 0, peak: 0 }
}

export interface RewriteContext {
  readonly client: LLMClient
  readonly model: string
  readonly jd?: CompiledJd
  readonly archive?: ArchiveV1
  readonly reference?: string
  readonly anchors: readonly StyleAnchor[]
  readonly maxAttempts: number
  readonly counter: CallCounter
}

/**
 * 唯一的出网调用点（本层）。
 *
 * 计数在 `await` 之前同步完成，因此「峰值并发」是**真实的同时在途数**，
 * 而不是一个事后估算：`Promise.all` 会在一个 microtask 内把 N 次调用全部发起。
 */
async function callOnce(ctx: RewriteContext, volatile: readonly LLMMessage[]): Promise<string> {
  ctx.counter.calls += 1
  ctx.counter.inFlight += 1
  if (ctx.counter.inFlight > ctx.counter.peak) ctx.counter.peak = ctx.counter.inFlight
  try {
    const response = await callLLM(ctx.client, {
      model: ctx.model,
      system: REWRITE_SYSTEM_PROMPT,
      ...(ctx.reference === undefined ? {} : { reference: ctx.reference }),
      ...(ctx.archive === undefined ? {} : { archive: ctx.archive }),
      volatile,
    })
    return response.text
  } finally {
    ctx.counter.inFlight -= 1
  }
}

/** 本地计算的 JD 关键词命中。与 `verify/gate.ts` 的覆盖判定同一套算法。 */
export function matchedKeywordsOf(text: string, jd: CompiledJd | undefined): readonly string[] {
  if (jd === undefined) return []
  const hay = normalizeWhitespace(text).toLowerCase()
  return jd.skills
    .map((skill) => skill.name)
    .filter((name) => hay.includes(normalizeWhitespace(name).toLowerCase()))
}

function failureOf(
  code: ParseFailure['code'],
  detail: string,
  feedbackLines: readonly string[],
): ParseFailure {
  return { code, detail, feedback: feedbackLines.join('\n') }
}

/**
 * 语义闸门：先查溯源声明，再跑硬校验。
 *
 * 顺序是刻意的 —— 逐字比对是本地字符串操作，比 `verifyBullets` 便宜，
 * 而且它失败时给出的修法比「换个动词」更根本：模型连依据都引错了，
 * 再去纠正它的动词开头没有意义。
 */
export function checkCandidate(
  output: RewriteOutput,
  candidate: RewriteCandidate,
  jd: CompiledJd | undefined,
): ParseFailure | null {
  const ungrounded: string[] = []
  if (!isGroundedIn(output.sourceSpan, candidate.sourceText)) {
    ungrounded.push(`sourceSpan「${output.sourceSpan}」`)
  }
  for (const item of output.evidence) {
    if (!isGroundedIn(item, candidate.sourceText)) ungrounded.push(`evidence「${item}」`)
  }
  if (ungrounded.length > 0) {
    return failureOf(
      'validation_failed',
      `溯源声明不是原文片段：${ungrounded.join('；')}`,
      [
        '上一条回复里的事实依据对不上原文。',
        ...ungrounded.map((item) => `- ${item} 在 <source> 中逐字找不到`),
        'sourceSpan 与 evidence 都必须是 <source> 里逐字复制出来的片段，不能转述、不能概括、不能润色。',
      ],
    )
  }

  const result = verifyBullets({
    bullets: [{ id: candidate.bulletId, text: output.text }],
    sources: [candidate.sourceText],
    ...(jd === undefined ? {} : { jd }),
  })
  if (result.pass) return null

  // 只看 fatal 与 hard。`target` 层过滤掉的理由见文件头。
  const blocking = result.failures.filter((failure) => failure.severity !== 'target')
  /* c8 ignore next -- pass=false 且无 fatal/hard 在 gate.ts 的语义下不可能发生 */
  if (blocking.length === 0) return null

  return failureOf(
    'validation_failed',
    `硬校验未通过：${blocking.map((f) => `${f.reason}(${f.offending})`).join('；')}`,
    [
      '上一条回复没有通过确定性校验，请重写这一条 bullet。',
      ...blocking.map((f) => `- [${f.reason}] 违规内容「${f.offending}」：${f.detail}`),
    ],
  )
}

/**
 * 改写一条。成功即返回产物，耗尽次数即返回失败条目 —— **不抛错**。
 *
 * 不抛错是有意的：40 条并发里抛出的第一个错误会把 `Promise.all` 变成
 * 「一条失败，三十九条白跑」。失败隔离的前提是失败不经过异常通道。
 */
export async function rewriteOne(
  candidate: RewriteCandidate,
  ctx: RewriteContext,
): Promise<RewrittenBullet | RewriteFailureEntry> {
  const volatile: LLMMessage[] = [
    { role: 'user', content: buildJdMessage(ctx.jd) },
    { role: 'user', content: buildBulletTask(candidate, ctx.anchors) },
  ]

  let lastFailure: ParseFailure | undefined

  for (let attempt = 1; attempt <= ctx.maxAttempts; attempt += 1) {
    const text = await callOnce(ctx, volatile)
    const parsed = parseStructured(text, rewriteOutputSchema)

    if (parsed.ok) {
      const bulletText = parsed.value.text.trim()
      const failure = checkCandidate(
        { ...parsed.value, text: bulletText },
        candidate,
        ctx.jd,
      )
      if (failure === null) {
        return {
          bulletId: candidate.bulletId,
          text: bulletText,
          sourceSpan: parsed.value.sourceSpan,
          evidence: parsed.value.evidence,
          declaredKeywords: parsed.value.keywordsHit,
          matchedKeywords: matchedKeywordsOf(bulletText, ctx.jd),
          attempts: attempt,
          anchorsUsed: ctx.anchors.map((anchor) => anchor.bulletId),
        }
      }
      lastFailure = failure
    } else {
      lastFailure = parsed.failure
    }

    if (attempt < ctx.maxAttempts) {
      volatile.push({ role: 'user', content: buildRetryMessage(lastFailure.feedback) })
    }
  }

  /* c8 ignore next -- 循环至少执行一次，故 lastFailure 必有值 */
  if (lastFailure === undefined) {
    throw new Error('改写循环未执行 —— 这是一个不该到达的分支')
  }
  return { bulletId: candidate.bulletId, attempts: ctx.maxAttempts, failure: lastFailure }
}
