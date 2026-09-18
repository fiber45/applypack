/**
 * 有界工具循环 —— DESIGN 9 的实现。
 *
 * ## 一轮里发生什么
 *
 * ```
 * ① 前置（只做一次）  score_match   → 按分数排序、按目标条数截断、留下淘汰理由
 * ② 每轮              rewrite       → 只重做「还没产出」与「违反闸门」的那些位置
 * ③ 每轮              verify_facts  → 确定性核验，产生本轮判定
 * ④ 结束前            keyword_gap   → JD 要的、素材里根本没有的技能
 * ⑤ 结束前            ask_user      → 把模型解决不了的问题登记成对用户的追问
 * ```
 *
 * ②③ 的顺序不能反。先核验再改写会让「这一轮该重做哪些」失去依据；
 * 而②只重做**有问题的位置**，不是整批重跑 —— 那是 DESIGN 8.4「失败隔离」
 * 从单条粒度上再抬一层：一条不许拖累三十九条，一轮也不该重做已经绿了的那些。
 *
 * ## 为什么第 ③ 步的结果不可能来自模型
 *
 * `verify_facts` 的实现在 `tools.ts` 里是 `Promise.resolve(...)` ——
 * **同步计算，包一层 Promise 只是为了让类型统一**。一个出网调用不可能同步完成。
 * 所以「验收器不许是 LLM」在这里不是纪律，是异步性的必然结果。
 *
 * ## 终止的六种方式（`TerminationReason`）
 *
 * 其中三种是绳子（轮数 / 预算 / 超时），一种成功，两种「诚实认输」：
 *
 *   - `needs_user`：还有问题，但没有任何可做的新事情了 —— 剩下的缺的是事实
 *   - `no_progress`：连续 N 轮的失败签名一模一样。**再去调一次模型是纯浪费**，
 *     因为输入一个字都没变（`rewrite` 的重试已经用过不同的反馈了）
 *
 * 第二种是「不死循环」这件事真正的保证。轮数上限只是兜底 ——
 * 靠上限终止意味着钱已经花完了，而 `no_progress` 是在看出无解的那一刻就停。
 *
 * @see DESIGN 9 · TASKS.md T3.3
 */

import { DEFAULT_MAX_ATTEMPTS } from '../compile/index'
import type { LLMClient, LLMResponse } from '../egress/index'
import { DEFAULT_ANCHOR_COUNT, selectAnchors, type RewriteFailureEntry, type RewrittenBullet, type StyleAnchor } from '../rewrite/index'
import type { Bullet, VerifyResult } from '../verify/index'
import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_NO_PROGRESS_LIMIT,
  checkRopes,
  estimateTokens,
  usageOf,
} from './budget'
import { dispatchTool, type AskUserArgs, type ScoreMatchResult } from './tools'
import type { AgentInput, AgentOptions, AgentOutcome, AgentQuestion, AgentStep, RejectedBullet, TerminationReason } from './types'
import { nextPending, summarizeVerdict, type Verdict } from './verdict'

const EMPTY_RESULT: VerifyResult = {
  pass: true,
  failures: [],
  metrics: { bulletCount: 0, quantificationRate: 1, keywordCoverage: 1, maxVerbRepeat: 0 },
}

/**
 * 记账用的客户端包装。
 *
 * 预算的计量放在循环这一层，而不是塞进 `core/rewrite` —— 理由有两条：
 * 改写层不需要知道「这次调用属于预算里的第几笔」（那会让它多一个
 * 与自身职责无关的参数），而预算本身就是**循环**的缰绳。
 * 包装 client 是唯一能在不碰改写层的前提下拿到每次调用的用量与次数的位置。
 */
function metered(
  client: LLMClient,
  account: { calls: number; tokens: number },
  estimator: (text: string) => number,
): LLMClient {
  return {
    complete: (request): Promise<LLMResponse> => {
      account.calls += 1
      return client.complete(request).then((response) => {
        const sent = [...request.cachedPrefix, ...request.volatile]
          .map((message) => message.content)
          .join('\n')
        account.tokens += usageOf(response.usage, sent, response.text, estimator)
        return response
      })
    },
  }
}

function rejectedFor(
  candidate: { readonly bulletId: string; readonly entryId: string },
  match: ScoreMatchResult | null,
  maxBullets: number,
): RejectedBullet {
  const explanation = match?.explanations.find((item) => item.entryId === candidate.entryId)
  if (explanation === undefined) {
    return {
      bulletId: candidate.bulletId,
      entryId: candidate.entryId,
      summary: `超出目标条数上限（${maxBullets} 条）。`,
      detail: [],
    }
  }
  return {
    bulletId: candidate.bulletId,
    entryId: candidate.entryId,
    summary: explanation.summary,
    detail: explanation.overtakenBy.map(
      (overtaken) => `被「${overtaken.label}」挤下（${overtaken.total.toFixed(1)} 分）`,
    ),
  }
}

/** 定稿产物按入选顺序排列 —— 报告的顺序不该随并发完成次序变。 */
function orderedBullets(
  order: readonly string[],
  produced: ReadonlyMap<string, RewrittenBullet>,
): readonly RewrittenBullet[] {
  const out: RewrittenBullet[] = []
  for (const bulletId of order) {
    const bullet = produced.get(bulletId)
    if (bullet !== undefined) out.push(bullet)
  }
  return out
}

export async function runAgent(input: AgentInput, options: AgentOptions): Promise<AgentOutcome> {
  const maxRounds = Math.max(1, Math.floor(options.maxRounds ?? DEFAULT_MAX_ROUNDS))
  const noProgressLimit = Math.max(
    1,
    Math.floor(options.noProgressLimit ?? DEFAULT_NO_PROGRESS_LIMIT),
  )
  const maxBullets = Math.max(0, Math.floor(input.maxBullets))
  const maxAttempts = Math.max(1, Math.floor(options.maxAttemptsPerBullet ?? DEFAULT_MAX_ATTEMPTS))
  const estimator = options.estimateTokens ?? estimateTokens
  const clock = options.clock ?? Date.now

  const log: AgentStep[] = []
  const questions: AgentQuestion[] = []
  const account = { calls: 0, tokens: 0 }
  const client = metered(options.client, account, estimator)
  const startedAt = clock()

  /* ① 前置：排序与截断 ------------------------------------------------- */

  let match: ScoreMatchResult | null = null
  if (input.items !== undefined && input.items.length > 0 && maxBullets > 0) {
    match = await dispatchTool('score_match', {
      items: input.items,
      jd: input.jd,
      now: options.now,
      limit: maxBullets,
    })
    log.push({
      round: 0,
      tool: 'score_match',
      detail: `${input.items.length} 条经历 → 入选 ${match.selectedIds.length} 条，入选线 ${match.cutoff.toFixed(1)} 分`,
    })
  }

  const shortlist =
    match === null
      ? input.candidates.slice(0, maxBullets)
      : input.candidates
          .filter((candidate) => match.selectedIds.includes(candidate.entryId))
          .slice(0, maxBullets)
  const shortlisted = new Set(shortlist.map((candidate) => candidate.bulletId))
  const rejected = input.candidates
    .filter((candidate) => !shortlisted.has(candidate.bulletId))
    .map((candidate) => rejectedFor(candidate, match, maxBullets))

  const expectedIds = shortlist.map((candidate) => candidate.bulletId)
  const sources = shortlist.map((candidate) => candidate.sourceText)

  if (shortlist.length === 0) {
    // 零产出必须显式认输。若让它走完循环，`verifyBullets` 在零条上的 `pass`
    // 是 `true`（没有条目就没有违规），「一条都没生成」会被报成「通过」。
    questions.push({
      bulletId: null,
      kind: 'missing_fact',
      prompt:
        input.candidates.length === 0
          ? '没有可改写的条目：档案里还没有任何经历。'
          : `没有条目通过筛选（目标条数 ${maxBullets}）。先看淘汰理由，或调高目标条数。`,
    })
    log.push({ round: 0, tool: 'ask_user', detail: '零入选：登记缺口并停止' })
    return {
      status: 'unfinished',
      termination: 'needs_user',
      bullets: [],
      rejected,
      failures: [],
      unfixable: [],
      metrics: EMPTY_RESULT.metrics,
      questions,
      rounds: 0,
      calls: account.calls,
      spentTokens: account.tokens,
      log,
    }
  }

  /* ②–③ 主循环 -------------------------------------------------------- */

  const produced = new Map<string, RewrittenBullet>()
  const lastFailures = new Map<string, RewriteFailureEntry>()
  let pending = new Set<string>(expectedIds)
  let anchors: readonly StyleAnchor[] = options.anchors ?? []
  const externalAnchors = (options.anchors ?? []).length > 0

  let rounds = 0
  let termination: TerminationReason | null = null
  let lastSignature: string | null = null
  let stalled = 0
  let result: VerifyResult = EMPTY_RESULT
  let verdict: Verdict = summarizeVerdict(EMPTY_RESULT, expectedIds, [])

  while (termination === null) {
    const rope = checkRopes(
      { roundsDone: rounds, spentTokens: account.tokens, elapsedMs: clock() - startedAt },
      {
        maxRounds,
        tokenBudget: options.tokenBudget ?? null,
        timeoutMs: options.timeoutMs ?? null,
      },
    )
    if (rope !== null) {
      termination = rope
      break
    }

    rounds += 1
    const batch = shortlist.filter((candidate) => pending.has(candidate.bulletId))

    const rewritten = await dispatchTool('rewrite', {
      client,
      model: options.model,
      candidates: batch,
      jd: input.jd,
      anchors,
      ...(options.archive === undefined ? {} : { archive: options.archive }),
      ...(options.reference === undefined ? {} : { reference: options.reference }),
      maxAttempts,
    })
    log.push({
      round: rounds,
      tool: 'rewrite',
      detail: `${batch.length} 条候选 → 通过 ${rewritten.report.rewritten.length}，未过闸门 ${rewritten.report.failed.length}；模型调用 ${rewritten.report.calls} 次，并发峰值 ${rewritten.report.concurrencyPeak}`,
    })
    for (const bullet of rewritten.report.rewritten) produced.set(bullet.bulletId, bullet)
    for (const entry of rewritten.report.failed) lastFailures.set(entry.bulletId, entry)

    const bullets = orderedBullets(expectedIds, produced)
    const toBullets: Bullet[] = bullets.map((bullet) => ({ id: bullet.bulletId, text: bullet.text }))
    const verified = await dispatchTool('verify_facts', {
      bullets: toBullets,
      sources,
      jd: input.jd,
    })
    result = verified.result
    verdict = summarizeVerdict(
      result,
      expectedIds,
      bullets.map((bullet) => bullet.bulletId),
    )
    log.push({
      round: rounds,
      tool: 'verify_facts',
      detail: `阻断级失败 ${verdict.blocking.length} 项，未产出 ${verdict.unresolved.length} 处；量化率 ${result.metrics.quantificationRate}，关键词覆盖 ${result.metrics.keywordCoverage}`,
    })

    if (verdict.pass) {
      termination = 'passed'
      break
    }

    const next = nextPending(verdict)
    if (next.length === 0) {
      termination = 'needs_user'
      break
    }

    if (verdict.signature === lastSignature) {
      stalled += 1
      if (stalled >= noProgressLimit) {
        termination = 'no_progress'
        break
      }
    } else {
      stalled = 0
      lastSignature = verdict.signature
    }

    pending = new Set(next)
    // 下一轮带上本轮已定稿的条目作风格锚点。调用方给了外部锚点时不覆盖它 ——
    // 用户/上一轮的锚点比本轮的更权威。
    if (!externalAnchors) {
      anchors = selectAnchors(orderedBullets(expectedIds, produced), DEFAULT_ANCHOR_COUNT)
    }
  }

  /* ④–⑤ 收尾：缺口与追问 ------------------------------------------------ */

  const gap = await dispatchTool('keyword_gap', {
    texts: sources,
    jd: input.jd,
  })
  log.push({
    round: rounds,
    tool: 'keyword_gap',
    detail: `素材侧命中 ${gap.hit.length} / ${input.jd.skills.length}，缺口 ${gap.missed.length} 项`,
  })

  /** 登记一次追问，并在审计日志里留痕 —— 日志漏掉 ask_user，会让「用了哪些工具」这件事查不全。 */
  const ask = async (args: AskUserArgs): Promise<void> => {
    const { question } = await dispatchTool('ask_user', args)
    questions.push(question)
    log.push({ round: rounds, tool: 'ask_user', detail: `${question.kind}：${question.prompt}` })
  }

  for (const bulletId of verdict.unresolved) {
    const reason = lastFailures.get(bulletId)
    await ask({
      bulletId,
      kind: 'unfixable_by_model',
      prompt:
        `「${bulletId}」反复改写都没能过闸门。` +
        (reason === undefined ? '' : `最后一次卡在：${reason.failure.detail} `) +
        '请检查它的原始素材：太短的句子、或没有可量化结果的描述，都会让这一条无法改出合格的简历用语。',
    })
  }

  const seenBullets = new Set<string>()
  for (const failure of verdict.blocking) {
    if (seenBullets.has(failure.bulletId)) continue
    seenBullets.add(failure.bulletId)
    await ask({
      bulletId: failure.bulletId,
      kind: 'unfixable_by_model',
      prompt: `「${failure.bulletId}」卡在「${failure.reason}」：${failure.detail} 原始素材里可能确实没有对应的事实，需要你确认或补充。`,
    })
  }

  if (gap.missed.length > 0) {
    await ask({
      bulletId: null,
      kind: 'missing_fact',
      prompt: `岗位要求里提到了 ${gap.missed.join('、')}，但你的素材里一处都没有出现。要么补一段相关经历，要么这份岗位与你的背景确实不匹配。`,
    })
  }

  return {
    status: termination === 'passed' ? 'passed' : 'unfinished',
    termination,
    bullets: orderedBullets(expectedIds, produced),
    rejected,
    failures: verdict.blocking,
    unfixable: expectedIds
      .map((bulletId) => lastFailures.get(bulletId))
      .filter((entry): entry is RewriteFailureEntry => entry !== undefined),
    metrics: result.metrics,
    questions,
    rounds,
    calls: account.calls,
    spentTokens: account.tokens,
    log,
  }
}
