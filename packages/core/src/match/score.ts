/**
 * 加权打分 —— 全程零 LLM 调用（ADR-4）。
 *
 * ADR-4 否决了「LLM 逐条判相关性」，理由是可复现、可解释、零边际成本。
 * 这三条里**可复现是前提**：一个不可复现的打分没法被解释，因为解释本身
 * 也会变。所以本文件有一条硬规矩：
 *
 *   **不读系统时间，不读随机数，不读外部状态。**
 *
 * 时间通过 `now` 参数显式传入。这不是洁癖 —— 一个内部调用 `Date.now()` 的
 * 时效评分，会让「同一个输入两次运行的结果不同」，而评测集跑 CI 的前提
 * 正是同输入同输出（TASKS.md T2.2）。
 */

import type { CompiledJd, JdSkill } from '../compile/index'
import { normalizeWhitespace } from '../verify/trace'
import type { MatchItem } from './types'

export interface MatchWeights {
  /** JD 技能命中 —— 权重最高，因为它是「能不能过简历关」的直接预测 */
  readonly keyword: number
  /** 时效 —— 校招场景下，两年前的实习与去年的实习不是一回事 */
  readonly recency: number
  /** 量化率 —— DESIGN 8.6 把它列为优化目标，占比过高会让「还没写好的草稿」被误杀 */
  readonly quantification: number
  /** 描述充实度 —— 权重最低，因为它最容易被「多写几句」刷分 */
  readonly depth: number
}

/**
 * 默认权重。四条依据，从上到下依次变弱：
 * 关键词覆盖决定能不能过机器筛，时效决定经历算不算数，量化率是可优化项，
 * 充实度只是兜底（防一条什么都没有的空条目拿高分）。
 * 和为 1，有断言守着。
 */
export const DEFAULT_WEIGHTS: MatchWeights = Object.freeze({
  keyword: 0.55,
  recency: 0.15,
  quantification: 0.15,
  depth: 0.15,
})

/** 程度词换算成权重系数：JD 说「精通」比说「了解」更值钱。 */
const PROFICIENCY_FACTOR: Readonly<Record<JdSkill['proficiency'], number>> = Object.freeze({
  expert: 1,
  proficient: 0.8,
  familiar: 0.6,
})

/** 导出给 reasons.ts 复用 —— 理由里的 impact 必须与打分用的是同一个权重，否则「解释」与「结果」会对不上。 */
export function skillWeight(skill: JdSkill): number {
  return (skill.required ? 2 : 1) * PROFICIENCY_FACTOR[skill.proficiency]
}

/** 把技能程度词翻译成人话，用于理由文案。 */
export const PROFICIENCY_LABEL: Readonly<Record<JdSkill['proficiency'], string>> = Object.freeze({
  expert: '要求精通',
  proficient: '要求熟悉',
  familiar: '了解即可',
})

export interface ScoreBreakdown {
  /** 四项分量的原始值，均为 [0, 1] */
  readonly keyword: number
  readonly recency: number
  readonly quantification: number
  readonly depth: number
  /** 加权总分，0–100，保留一位小数 */
  readonly total: number
  readonly keywordsHit: readonly string[]
  readonly keywordsMissed: readonly string[]
  readonly keywordsMissedRequired: readonly string[]
}

function haystack(item: MatchItem): string {
  return normalizeWhitespace(item.texts.join(' ')).toLowerCase()
}

/** `YYYY-MM` 之间相差的月数；`to` 早于 `from` 时返回负数，调用方负责钳制。 */
function monthsBetween(from: string, to: string): number | null {
  const left = /^(\d{4})-(\d{2})$/.exec(from)
  const right = /^(\d{4})-(\d{2})$/.exec(to)
  if (left === null || right === null) return null
  const fromMonths = Number(left[1]) * 12 + Number(left[2])
  const toMonths = Number(right[1]) * 12 + Number(right[2])
  return toMonths - fromMonths
}

/**
 * 时效评分。缺失日期时给 0.3 而不是 0：
 * 「没写时间」与「很久以前」都是缺陷，但前者是可修的数据问题，
 * 不该在打分阶段就把它判成后者。这个 0.3 是个**有意的偏袒**，写在注释里以免被当成 magic number 优化掉。
 */
function recencyScore(item: MatchItem, now: string): number {
  const anchor = item.endDate ?? item.startDate
  if (anchor === null) return 0.3
  const months = monthsBetween(anchor, now)
  if (months === null) return 0.3
  if (months <= 12) return 1
  if (months <= 24) return 0.7
  if (months <= 48) return 0.4
  return 0.15
}

function quantificationScore(item: MatchItem): number {
  if (item.highlightCount === 0) return 0
  return Math.min(1, item.quantifiedCount / item.highlightCount)
}

function depthScore(item: MatchItem): number {
  const countPart = Math.min(1, item.highlightCount / 4)
  const chars = item.texts.join('').length
  const lengthPart = Math.min(1, chars / 300)
  return countPart * 0.5 + lengthPart * 0.5
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function scoreItem(
  item: MatchItem,
  jd: CompiledJd,
  now: string,
  weights: MatchWeights = DEFAULT_WEIGHTS,
): ScoreBreakdown {
  const hay = haystack(item)

  const hit: string[] = []
  const missed: string[] = []
  let hitWeight = 0
  let totalWeight = 0
  const missedRequired: string[] = []

  for (const skill of jd.skills) {
    const weight = skillWeight(skill)
    totalWeight += weight
    if (hay.includes(normalizeWhitespace(skill.name).toLowerCase())) {
      hit.push(skill.name)
      hitWeight += weight
    } else {
      missed.push(skill.name)
      if (skill.required) missedRequired.push(skill.name)
    }
  }

  // 没有任何技能时 keyword 维度不参与惩罚：给 1 而不是 0。
  // 若给 0，一份技能列不全的 JD 会让**所有**条目一起失分，排序不变而分数全废。
  const keyword = totalWeight === 0 ? 1 : hitWeight / totalWeight
  const recency = recencyScore(item, now)
  const quantification = quantificationScore(item)
  const depth = depthScore(item)

  const total =
    keyword * weights.keyword +
    recency * weights.recency +
    quantification * weights.quantification +
    depth * weights.depth

  return {
    keyword,
    recency,
    quantification,
    depth,
    total: round1(total * 100),
    keywordsHit: hit,
    keywordsMissed: missed,
    keywordsMissedRequired: missedRequired,
  }
}
