/**
 * 硬校验闸门 —— 管线第 6 步，DESIGN 3.3 称之为**整份方案的工程质量核心**。
 *
 * 核心命题只有一句：**模型输出的每一个数字都必须在原文中可溯源。**
 * 没有任何新的数字。任何一处违反直接拒绝并回炉。
 *
 * 这句话之所以重要，是因为它把「润色」这件事从
 * 「看起来像那么回事」升级为**「可验证地没有撒谎」** —— 而这两者在招聘场景里
 * 的区别是决定性的：「提升 40%」这句话写进简历，是要被面试官追问的。
 *
 * ## 三层严重性
 *
 * | 层 | 含义 | 不达标的后果 |
 * |---|---|---|
 * | `fatal` | 一票否决（数字溯源） | 无条件失败，必须重写 |
 * | `hard` | 硬约束（强动词/被动语态/长度/动词重复） | 失败，必须重写 |
 * | `target` | 优化目标（量化率/关键词覆盖） | **不算失败**，但会出现在失败列表里 |
 *
 * `target` 不算失败是刻意的。闸门的用途是「有没有撒谎」，不是「写得好不好」——
 * 若把量化率也做成阻断项，一份还没改好的草稿会连「检查有没有编数字」都过不去，
 * 而 Agent 循环（T3.3）恰恰需要先拿到一份诚实的稿子，再逐轮优化它的指标。
 * 所以 `pass` 只看前两层，`failures` 里三层都有。
 *
 * @see DESIGN 3.3 第 6 步 · 8.6 · AGENTS.md 红线 6
 */

import type { CompiledJd } from '../compile/index'
import { extractNumbers, untraceableNumbers } from './numbers'
import { normalizeWhitespace } from './trace'
import { hasPassiveVoice, isCjkDominant, isStrongOpening, leadingToken, weakOpener } from './verbs'

export type FailureReason =
  | 'number_not_in_source'
  | 'weak_verb_opening'
  | 'passive_voice'
  | 'too_long'
  | 'verb_repetition'
  | 'low_quantification'
  | 'low_keyword_coverage'

export type FailureSeverity = 'fatal' | 'hard' | 'target'

/** 一票否决项。这些理由出现一次，整份稿子就必须回炉。 */
export const FATAL_REASONS: readonly FailureReason[] = Object.freeze(['number_not_in_source'])

export interface Failure {
  readonly reason: FailureReason
  readonly severity: FailureSeverity
  /** 违规条目的 id；整体性指标用 `<全局>` */
  readonly bulletId: string
  /** **具体的违规内容** —— 不是「写得不好」，而是「40 这个数字」「『参与』这个词」 */
  readonly offending: string
  readonly detail: string
}

export interface Bullet {
  readonly id: string
  readonly text: string
}

export interface VerifyThresholds {
  /** 中文单条字符上限 */
  readonly maxChars: number
  /** 英文单条词数上限。与中文字数分开，因为 45 个英文词是两倍于 45 个汉字的信息量 */
  readonly maxWords: number
  /** 同一个开头动词最多出现在几条里 */
  readonly maxVerbRepeat: number
  /** 含数字的条目占比下限 */
  readonly minQuantification: number
  /** JD 技能命中率下限 */
  readonly minKeywordCoverage: number
}

export const DEFAULT_THRESHOLDS: VerifyThresholds = Object.freeze({
  maxChars: 45,
  maxWords: 25,
  maxVerbRepeat: 2,
  minQuantification: 0.7,
  minKeywordCoverage: 0.6,
})

export interface VerifyInput {
  readonly bullets: readonly Bullet[]
  /** 事实来源：未经改写的原始文本。数字与实体只能从这些文本里来。 */
  readonly sources: readonly string[]
  readonly jd?: CompiledJd
  readonly thresholds?: Partial<VerifyThresholds>
}

export interface VerifyMetrics {
  readonly bulletCount: number
  readonly quantificationRate: number
  readonly keywordCoverage: number
  readonly maxVerbRepeat: number
}

export interface VerifyResult {
  /** 只反映 `fatal` 与 `hard`。`target` 未达标不算失败，见文件头说明。 */
  readonly pass: boolean
  readonly failures: readonly Failure[]
  readonly metrics: VerifyMetrics
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function checkNumbers(bullets: readonly Bullet[], sources: readonly string[]): Failure[] {
  const failures: Failure[] = []
  for (const bullet of bullets) {
    for (const number of untraceableNumbers(bullet.text, sources)) {
      failures.push({
        reason: 'number_not_in_source',
        severity: 'fatal',
        bulletId: bullet.id,
        offending: number,
        detail: `「${number}」在原始素材中找不到依据：${bullet.text}`,
      })
    }
  }
  return failures
}

function checkOpenings(bullets: readonly Bullet[]): Failure[] {
  const failures: Failure[] = []
  for (const bullet of bullets) {
    const weak = weakOpener(bullet.text)
    if (weak !== null) {
      failures.push({
        reason: 'weak_verb_opening',
        severity: 'hard',
        bulletId: bullet.id,
        offending: weak,
        detail: `以弱动词/弱短语「${weak}」开头，改为强动词开头（如「负责」「主导」「Designed」「Led」）`,
      })
      // 已经确认是弱开头，不再重复报「不在强动词表里」——同一条只该被指出一次。
      continue
    }
    if (!isStrongOpening(bullet.text)) {
      const token = leadingToken(bullet.text) ?? ''
      failures.push({
        reason: 'weak_verb_opening',
        severity: 'hard',
        bulletId: bullet.id,
        offending: token,
        detail: `开头「${token}」不是强动词。改成强动词开头（Led / Built / Designed / 负责 / 主导 …）`,
      })
    }
  }
  return failures
}

function checkPassiveVoice(bullets: readonly Bullet[]): Failure[] {
  const failures: Failure[] = []
  for (const bullet of bullets) {
    if (hasPassiveVoice(bullet.text)) {
      failures.push({
        reason: 'passive_voice',
        severity: 'hard',
        bulletId: bullet.id,
        offending: bullet.text.slice(0, 20),
        detail: '出现被动语态，改为主动语态',
      })
    }
  }
  return failures
}

function checkLength(bullets: readonly Bullet[], thresholds: VerifyThresholds): Failure[] {
  const failures: Failure[] = []
  for (const bullet of bullets) {
    if (isCjkDominant(bullet.text)) {
      if (bullet.text.length > thresholds.maxChars) {
        failures.push({
          reason: 'too_long',
          severity: 'hard',
          bulletId: bullet.id,
          offending: `${bullet.text.length} 字`,
          detail: `超过 ${thresholds.maxChars} 字上限`,
        })
      }
      continue
    }
    const words = bullet.text.trim().split(/\s+/).filter((word) => word !== '').length
    if (words > thresholds.maxWords) {
      failures.push({
        reason: 'too_long',
        severity: 'hard',
        bulletId: bullet.id,
        offending: `${words} 词`,
        detail: `超过 ${thresholds.maxWords} 词上限`,
      })
    }
  }
  return failures
}

/** 动词重复是**跨条目**的指标，所以它返回的失败可能落在多条上。 */
function checkVerbRepetition(
  bullets: readonly Bullet[],
  thresholds: VerifyThresholds,
): { failures: Failure[]; maxRepeat: number } {
  const byVerb = new Map<string, string[]>()
  for (const bullet of bullets) {
    const verb = leadingToken(bullet.text)
    if (verb === null) continue
    const list = byVerb.get(verb)
    if (list === undefined) byVerb.set(verb, [bullet.id])
    else list.push(bullet.id)
  }

  const failures: Failure[] = []
  let maxRepeat = 0
  for (const [verb, ids] of byVerb) {
    maxRepeat = Math.max(maxRepeat, ids.length)
    // 只报超出上限的部分：出现 3 次、上限 2 时，报第 3 条 —— 前两条是允许的。
    for (const id of ids.slice(thresholds.maxVerbRepeat)) {
      failures.push({
        reason: 'verb_repetition',
        severity: 'hard',
        bulletId: id,
        offending: verb,
        detail: `开头动词「${verb}」已出现 ${ids.length} 次，超过 ${thresholds.maxVerbRepeat} 次上限`,
      })
    }
  }
  return { failures, maxRepeat }
}

function checkQuantification(
  bullets: readonly Bullet[],
  thresholds: VerifyThresholds,
): { failures: Failure[]; rate: number } {
  if (bullets.length === 0) return { failures: [], rate: 1 }
  const quantified = bullets.filter((bullet) => extractNumbers(bullet.text).length > 0).length
  const rate = quantified / bullets.length
  if (rate >= thresholds.minQuantification) return { failures: [], rate }

  const percent = Math.round(rate * 100)
  const target = Math.round(thresholds.minQuantification * 100)
  return {
    rate,
    failures: [
      {
        reason: 'low_quantification',
        severity: 'target',
        bulletId: '<全局>',
        offending: `${percent}%`,
        detail: `${bullets.length} 条中仅 ${quantified} 条含数字（${percent}%），低于 ${target}% 目标`,
      },
    ],
  }
}

function checkKeywordCoverage(
  bullets: readonly Bullet[],
  jd: CompiledJd | undefined,
  thresholds: VerifyThresholds,
): { failures: Failure[]; coverage: number } {
  if (jd === undefined || jd.skills.length === 0) return { failures: [], coverage: 1 }

  const hay = normalizeWhitespace(bullets.map((bullet) => bullet.text).join(' ')).toLowerCase()
  const missed = jd.skills.filter(
    (skill) => !hay.includes(normalizeWhitespace(skill.name).toLowerCase()),
  )
  const coverage = (jd.skills.length - missed.length) / jd.skills.length
  if (coverage >= thresholds.minKeywordCoverage) return { failures: [], coverage }

  const percent = Math.round(coverage * 100)
  const target = Math.round(thresholds.minKeywordCoverage * 100)
  return {
    coverage,
    failures: [
      {
        reason: 'low_keyword_coverage',
        severity: 'target',
        bulletId: '<全局>',
        offending: missed.map((skill) => skill.name).join('、'),
        detail: `JD 关键词覆盖 ${percent}%，低于 ${target}% 目标；未命中：${missed
          .map((skill) => skill.name)
          .join('、')}`,
      },
    ],
  }
}

/**
 * 执行全部校验。
 *
 * 纯函数、零 LLM、零网络、不读系统时间 —— 同一个输入永远得到同一个结果。
 * 这是评测集能作为 CI 阻断项的前提，也是 AGENTS.md 红线 6 的落地。
 */
export function verifyBullets(input: VerifyInput): VerifyResult {
  const thresholds: VerifyThresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds }

  const verbs = checkVerbRepetition(input.bullets, thresholds)
  const quantification = checkQuantification(input.bullets, thresholds)
  const coverage = checkKeywordCoverage(input.bullets, input.jd, thresholds)

  const failures: Failure[] = [
    ...checkNumbers(input.bullets, input.sources),
    ...checkOpenings(input.bullets),
    ...checkPassiveVoice(input.bullets),
    ...checkLength(input.bullets, thresholds),
    ...verbs.failures,
    ...quantification.failures,
    ...coverage.failures,
  ]

  return {
    pass: failures.every((failure) => failure.severity === 'target'),
    failures,
    metrics: {
      bulletCount: input.bullets.length,
      quantificationRate: round2(quantification.rate),
      keywordCoverage: round2(coverage.coverage),
      maxVerbRepeat: verbs.maxRepeat,
    },
  }
}

/**
 * 只回答一个问题：**这一稿有没有编造数字。**
 *
 * TASKS.md 的 T3.2 要求「一票否决项必须能被单独测」。单独测的前提是它
 * 能单独**被调用** —— 否则想验证数字闸门，就得先构造一份同时在动词、长度、
 * 量化率上全部达标的稿子，而那样的测试一旦某天因为别的原因变红，
 * 你会以为是数字闸门坏了。这个函数让失败原因不可混淆。
 */
export function verifyFacts(bullets: readonly Bullet[], sources: readonly string[]): VerifyResult {
  const result = verifyBullets({ bullets, sources })
  const fatal = result.failures.filter((failure) => failure.severity === 'fatal')
  return { pass: fatal.length === 0, failures: fatal, metrics: result.metrics }
}
