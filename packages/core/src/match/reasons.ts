/**
 * 理由生成 —— T2.2 验收里那句「单测必须覆盖『为什么删了我这段实习』」的落地点。
 *
 * 这个文件要回答的不是「分数是多少」，是 **「我该改什么」**。两者差别很大：
 * 一个只说 42.3 分的报告，用户唯一能做的动作是「再写多一点」；
 * 一份说「未命中 JD 必备技能『推荐系统』，这一项就让我少了 13.8 分」的报告，
 * 用户知道该去补什么。
 *
 * 所以每条 reason 都带 `impact`，而它的语义是**「相对满分的差额」**：
 *
 *   命中项 = 0      ——「这一项没有失分」，不是「这一项加了 0 分」
 *   失分项 = 负值    —— 具体丢了多少
 *
 * 这个约定的价值在于它给出一条**可核对的恒等式**：
 *
 *   Σ(全部 impact) ≈ 总分 - 100
 *
 * 用户可以把报告上每条理由的分数加起来，验证它确实等于自己的总分离满分差了多少。
 * 这是他能验证「这套打分有没有在糊弄我」的唯一手段 —— 而这恰恰是 ADR-4
 * 选择确定性匹配而非 LLM 判分时承诺的东西。容差（±0.5）来自
 * `MIN_REPORTED_IMPACT`：低于半分的项不单独成条。
 *
 * @see DESIGN 8.5 / 8.6 · TASKS.md T2.2
 */

import type { CompiledJd } from '../compile/index'
import { PROFICIENCY_LABEL, skillWeight, type MatchWeights, type ScoreBreakdown } from './score'
import type { MatchItem, Reason } from './types'

/** 低于这个幅度的失分不单独成条 —— 一屏里塞满「-0.2 分」的理由，等于没有理由。 */
const MIN_REPORTED_IMPACT = 0.5

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function compareByMagnitude(a: Reason, b: Reason): number {
  return Math.abs(b.impact) - Math.abs(a.impact)
}

function recencyReasonLabel(item: MatchItem, now: string): string {
  const anchor = item.endDate ?? item.startDate
  if (anchor === null) return '条目未标注时间，时效无法评估'
  return `结束于 ${anchor}，距离 ${now} 较久`
}

/** 生成一条条目的全部理由，按影响幅度降序。 */
export function buildReasons(
  item: MatchItem,
  breakdown: ScoreBreakdown,
  jd: CompiledJd,
  weights: MatchWeights,
  now: string,
): readonly Reason[] {
  const reasons: Reason[] = []

  const totalWeight = jd.skills.reduce((sum, skill) => sum + skillWeight(skill), 0)
  // 每个技能在总分里占的额度。「没拿到」= 少了这么多。
  const quota = totalWeight === 0 ? 0 : (weights.keyword * 100) / totalWeight
  const hitSet = new Set(breakdown.keywordsHit)

  for (const skill of jd.skills) {
    const impact = skillWeight(skill) * quota
    const tier = skill.required ? '必备' : '加分'
    const level = PROFICIENCY_LABEL[skill.proficiency]

    if (hitSet.has(skill.name)) {
      reasons.push({
        kind: 'keyword_hit',
        label: `命中 JD${tier}技能「${skill.name}」（${level}）`,
        impact: 0,
      })
    } else if (impact >= MIN_REPORTED_IMPACT) {
      reasons.push({
        kind: 'keyword_missed',
        label: `未命中 JD${tier}技能「${skill.name}」（${level}）`,
        impact: round1(-impact),
      })
    }
  }

  // 其余三个维度：满分是 1，所以 (value - 1) 就是「离满分差多少」。
  const recencyLoss = (breakdown.recency - 1) * weights.recency * 100
  if (recencyLoss <= -MIN_REPORTED_IMPACT) {
    reasons.push({
      kind: 'recency',
      label: recencyReasonLabel(item, now),
      impact: round1(recencyLoss),
    })
  }

  const quantificationLoss = (breakdown.quantification - 1) * weights.quantification * 100
  if (quantificationLoss <= -MIN_REPORTED_IMPACT) {
    reasons.push({
      kind: 'quantification',
      label:
        item.highlightCount === 0
          ? '没有任何要点描述'
          : `${item.highlightCount} 条要点中仅 ${item.quantifiedCount} 条含数字`,
      impact: round1(quantificationLoss),
    })
  }

  const depthLoss = (breakdown.depth - 1) * weights.depth * 100
  if (depthLoss <= -MIN_REPORTED_IMPACT) {
    reasons.push({
      kind: 'depth',
      label: `描述偏少（${item.highlightCount} 条要点）`,
      impact: round1(depthLoss),
    })
  }

  return reasons.sort(compareByMagnitude)
}

export interface OvertakenBy {
  readonly entryId: string
  readonly label: string
  readonly total: number
}

export interface RejectionExplanation {
  readonly entryId: string
  readonly label: string
  readonly total: number
  readonly cutoff: number
  /** 最主要的失分项。用户第一个该看的东西。 */
  readonly blockingReason: Reason | null
  /** 挤掉它的条目（最接近的几个） */
  readonly overtakenBy: readonly OvertakenBy[]
  /** 一句话总结，可直接展示给用户 */
  readonly summary: string
}

export function labelOf(item: MatchItem): string {
  const parts = [item.organization, item.title].filter((part) => part !== '')
  return parts.length === 0 ? item.entryId : parts.join(' · ')
}

/**
 * 生成淘汰解释。
 *
 * `blockingReason` 只取**负向**理由里幅度最大的那条。这一点不能含糊：
 * 如果一条条目命中了 JD 的全部技能但败在时效上，最有用的信息是
 * 「它太旧了」，而不是「它命中了 3 个技能」—— 后者它已经做到了，不需要被提醒。
 */
export function explainRejection(
  item: MatchItem,
  reasons: readonly Reason[],
  total: number,
  cutoff: number,
  overtakenBy: readonly OvertakenBy[],
): RejectionExplanation {
  const negative = reasons.filter((reason) => reason.impact < 0)
  const blocking = negative[0] ?? null

  const summaryParts = [
    `「${labelOf(item)}」未入选（总分 ${total} / 入选线 ${cutoff}）`,
  ]
  if (blocking !== null) {
    summaryParts.push(`主要失分：${blocking.label}（${blocking.impact} 分）`)
  } else {
    summaryParts.push('各项指标均无明显短板，只是排在入选线之后')
  }
  if (overtakenBy.length > 0) {
    const top = overtakenBy[0]
    /* c8 ignore next */
    if (top !== undefined) {
      summaryParts.push(`分数最接近的入选条目是「${top.label}」（${top.total} 分）`)
    }
  }

  return {
    entryId: item.entryId,
    label: labelOf(item),
    total,
    cutoff,
    blockingReason: blocking,
    overtakenBy,
    summary: `${summaryParts.join('；')}。`,
  }
}
