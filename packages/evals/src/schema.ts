/**
 * 评测用例的结构与**用例自身的校验**。
 *
 * ## 为什么用例文件也必须被校验
 *
 * 一份 JSON 里的 `"kind": "overloug"` 不会让任何东西报错 —— 跑起来的时候
 * 它只是走进一个没人认领的分支，用例静默地不测任何东西。
 * 而「评测集全绿」这句话的全部价值就在于它没有静默的洞。
 *
 * 所以这里除了字段类型，还钉了一条**语义一致性**规则：
 * 用例的 `kind` 与它 `expect` 里的失败原因必须对得上
 * （`overlong` 用例必须期望 `too_long`，`clean` 用例必须期望零失败）。
 * 这条规则能拦住的正是最危险的一种坏用例：**标错标签的用例**——
 * 它看起来在覆盖某个场景，实际上在测别的东西。
 */

import type { Bullet, FailureReason } from '../../core/src/index'

export const EVAL_KINDS = [
  /** 合格条目：必须通过，且零失败。**没有这一类，用例集可以靠「全部拒绝」刷绿** */
  'clean',
  /** 幻觉数字：编造了原文里没有的数字 */
  'hallucinated_number',
  /** 超长 */
  'overlong',
  /** 弱动词开头 */
  'weak_verb',
  /** 被动语态 */
  'passive_voice',
  /** 同一动词重复超限 */
  'verb_repetition',
  /** 关键词缺口（目标层：不构成失败） */
  'keyword_gap',
  /** 量化率不足（目标层：不构成失败） */
  'low_quantification',
  /** 跨语言数字集合不一致 */
  'language_parity',
] as const

export type EvalKind = (typeof EVAL_KINDS)[number]

/** 每个 kind 必须期望的失败原因。`null` 表示「必须零失败」。 */
export const KIND_EXPECTED_REASON: Readonly<Record<EvalKind, FailureReason | null>> = Object.freeze({
  clean: null,
  hallucinated_number: 'number_not_in_source',
  overlong: 'too_long',
  weak_verb: 'weak_verb_opening',
  passive_voice: 'passive_voice',
  verb_repetition: 'verb_repetition',
  keyword_gap: 'low_keyword_coverage',
  low_quantification: 'low_quantification',
  language_parity: null,
})

const FAILURE_REASONS: readonly FailureReason[] = [
  'number_not_in_source',
  'weak_verb_opening',
  'passive_voice',
  'too_long',
  'verb_repetition',
  'low_quantification',
  'low_keyword_coverage',
]

/** 目标层的原因：不构成失败，因此 `pass: true` 与它们共存是合法的。 */
const TARGET_LAYER_REASONS: readonly FailureReason[] = ['low_keyword_coverage', 'low_quantification']

export interface ExpectedFailure {
  readonly reason: FailureReason
  readonly bulletId: string
  /**
   * 违规内容。**可选**。
   *
   * 只在它是这条用例的考点时才写（例如「编的那个数字是 40」）。
   * 若把它要求成必填，每一条用例都要依赖闸门的错误文案细节 ——
   * 那时改一次文案会引发几十处与考点无关的用例修改，
   * 而**文案不是被测对象**。
   */
  readonly offending?: string
}

export interface ParityExpectation {
  readonly ok: boolean
  readonly onlyInLeft?: readonly string[]
  readonly onlyInRight?: readonly string[]
}

export interface EvalCase {
  readonly id: string
  readonly kind: EvalKind
  readonly note: string
  readonly input: {
    readonly bullets?: readonly Bullet[]
    readonly sources?: readonly string[]
    /** 构造一个只含这些技能词的最小 JD。省略即不设关键词要求。 */
    readonly skills?: readonly string[]
    readonly left?: readonly string[]
    readonly right?: readonly string[]
  }
  readonly expect: {
    readonly pass?: boolean
    readonly failures?: readonly ExpectedFailure[]
    readonly parity?: ParityExpectation
  }
}

export interface CaseProblem {
  readonly origin: string
  readonly path: string
  readonly message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.every((item) => typeof item === 'string') ? (value as string[]) : null
}

/**
 * 校验一条用例。返回问题清单，空数组即合法。
 *
 * 刻意**不做类型收窄式的返回**（`ok: true` 才给 `EvalCase`）：调用方拿到问题
 * 之后依然要把它渲染成「哪一条用例、哪个字段、错在哪」。一个只说
 * 「用例不合法」的校验器，会让人靠肉眼去找，而肉眼正是那个漏掉 typo 的东西。
 */
export function validateCase(raw: unknown, origin: string): CaseProblem[] {
  const problems: CaseProblem[] = []
  const add = (path: string, message: string): void => {
    problems.push({ origin, path, message })
  }

  if (!isRecord(raw)) {
    add('<根>', '用例必须是一个 JSON 对象')
    return problems
  }

  if (typeof raw.id !== 'string' || raw.id === '') add('id', '必填，且不能是空串')
  if (typeof raw.note !== 'string' || raw.note === '') {
    add('note', '必填：一句话说清这条用例在测什么。没有它，未来没人敢改这条用例')
  }

  const kind = raw.kind
  if (typeof kind !== 'string' || !(EVAL_KINDS as readonly string[]).includes(kind)) {
    add('kind', `必须是 ${EVAL_KINDS.join(' / ')} 之一，实际是 ${JSON.stringify(raw.kind)}`)
    return problems
  }
  const typedKind = kind as EvalKind

  const input = raw.input
  if (!isRecord(input)) {
    add('input', '必填')
    return problems
  }

  const expect = raw.expect
  if (!isRecord(expect)) {
    add('expect', '必填')
    return problems
  }

  const expectedReason = KIND_EXPECTED_REASON[typedKind]

  if (typedKind === 'language_parity') {
    const left = stringArray(input.left)
    const right = stringArray(input.right)
    if (left === null || left.length === 0) add('input.left', '语言一致性用例必须有 left 文本')
    if (right === null || right.length === 0) add('input.right', '语言一致性用例必须有 right 文本')
    if (!isRecord(expect.parity) || typeof (expect.parity as Record<string, unknown>).ok !== 'boolean') {
      add('expect.parity', '语言一致性用例必须写 expect.parity.ok')
    }
    if (expect.pass !== undefined || expect.failures !== undefined) {
      add('expect', '语言一致性用例走 parity 分支，不该同时写 pass / failures')
    }
    return problems
  }

  const bullets = Array.isArray(input.bullets) ? input.bullets : null
  if (bullets === null || bullets.length === 0) add('input.bullets', '至少一条 bullet')
  else {
    bullets.forEach((bullet, index) => {
      if (!isRecord(bullet) || typeof bullet.id !== 'string' || typeof bullet.text !== 'string') {
        add(`input.bullets.${index}`, '必须是 { id: string, text: string }')
      }
    })
  }

  const sources = stringArray(input.sources)
  if (sources === null || sources.length === 0) {
    add('input.sources', '必须给事实来源 —— 没有来源就没有溯源，也就测不出幻觉')
  }

  if (typeof expect.pass !== 'boolean') {
    add('expect.pass', '必填：这条用例期望闸门通过还是不通过')
  }

  const failures = Array.isArray(expect.failures) ? expect.failures : null
  if (failures === null) {
    add('expect.failures', '必填（可以是空数组）')
    return problems
  }

  failures.forEach((failure, index) => {
    if (!isRecord(failure)) {
      add(`expect.failures.${index}`, '必须是对象')
      return
    }
    const reason = failure.reason
    if (typeof reason !== 'string' || !FAILURE_REASONS.includes(reason as FailureReason)) {
      add(`expect.failures.${index}.reason`, `必须是 ${FAILURE_REASONS.join(' / ')} 之一`)
    }
    if (typeof failure.bulletId !== 'string') {
      add(`expect.failures.${index}.bulletId`, '必填（全局指标用 "<全局>"）')
    }
    if (failure.offending !== undefined && typeof failure.offending !== 'string') {
      add(`expect.failures.${index}.offending`, '若写了就必须是字符串')
    }
  })

  // —— 语义一致性：kind 与 expect 必须对得上。这一条拦的是「标错标签的用例」。
  if (expectedReason === null) {
    if (expect.pass !== true || failures.length !== 0) {
      add('expect', `${typedKind} 用例必须期望 pass: true 且零失败`)
    }
  } else {
    const hasExpected = failures.some(
      (failure) => isRecord(failure) && failure.reason === expectedReason,
    )
    if (!hasExpected) {
      add('expect.failures', `${typedKind} 用例必须期望至少一条 ${expectedReason}`)
    }
    if (expect.pass === true && !TARGET_LAYER_REASONS.includes(expectedReason)) {
      add('expect.pass', `${expectedReason} 是硬约束，期望值不该是 true`)
    }
  }

  return problems
}

export interface CollectedCases {
  readonly cases: readonly EvalCase[]
  readonly problems: readonly CaseProblem[]
  /** 用例总数，含不合法的那些 —— 「凑够 30 条」不该靠坏用例 */
  readonly total: number
}

/** 汇总多份 JSON，顺带检查 id 唯一（重名会让报告指向两条不同的用例）。 */
export function collectCases(entries: readonly { origin: string; data: unknown }[]): CollectedCases {
  const cases: EvalCase[] = []
  const problems: CaseProblem[] = []
  let total = 0
  const seen = new Map<string, string>()

  for (const entry of entries) {
    if (!Array.isArray(entry.data)) {
      problems.push({ origin: entry.origin, path: '<根>', message: '用例文件必须是一个数组' })
      continue
    }
    for (const raw of entry.data) {
      total += 1
      const found = validateCase(raw, entry.origin)
      problems.push(...found)
      if (found.length > 0) continue
      const id = (raw as EvalCase).id
      const previous = seen.get(id)
      if (previous !== undefined) {
        problems.push({ origin: entry.origin, path: 'id', message: `id「${id}」与 ${previous} 重复` })
        continue
      }
      seen.set(id, entry.origin)
      cases.push(raw as EvalCase)
    }
  }

  return { cases, problems, total }
}
