/**
 * 结构化输出的解析闸门。
 *
 * 职责只有一个：**把模型返回的一段自由文本，变成「通过 schema 的对象」或「一份结构化的失败」**。
 * 不修数据、不猜意图、不做容错式清洗。
 *
 * 刻意不做的几件事，每一件都是拒绝掉的诱惑：
 * - **不去掉尾随逗号**：那是在替模型猜它想写什么。猜对了省一次重试，
 *   猜错了会把一个真实的语法错误变成一个静默的语义错误。
 * - **不补默认值**：缺字段就是失败。补默认值会让「模型没给」与「模型给了 null」
 *   在下游无法区分，而这两者在 `compiledEntrySchema` 里是不同含义。
 * - **不把 feedback 里塞进模型原文**：重试提示只带错误摘要。原始回复可能有几千字，
 *   塞进去会让下一次请求的成本翻倍；更重要的是，它可能含用户数据 ——
 *   而这些数据本来是被投影层挡在上下文里的。
 *
 * @see DESIGN 8.3 / 8.5 · AGENTS.md §7
 */

import type { ZodType } from 'zod'

export type ParseFailureCode =
  | 'empty_response'
  | 'no_json_found'
  | 'invalid_json'
  | 'schema_mismatch'
  /** 结构合法但没过语义闸门（如数字无法溯源）。见 runner.ts 的 `validate`。 */
  | 'validation_failed'

export interface ParseFailure {
  readonly code: ParseFailureCode
  /** 给人看的诊断信息，**不含模型原文** */
  readonly detail: string
  /** 给模型看的重试提示。下一条 user message 就是它 */
  readonly feedback: string
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ParseFailure }

/** 整段文本本身就是一个完整的 JSON 值（对象或数组）且语法合法。 */
function isWholeJsonValue(text: string): boolean {
  const first = text[0]
  const last = text[text.length - 1]
  const wrapped =
    (first === '{' && last === '}') || (first === '[' && last === ']')
  if (!wrapped) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/**
 * 从回复里切出最可能是 JSON 的那一段。
 *
 * 优先级顺序是有讲究的，第一档尤其重要：
 *
 * 1. **整体就是 JSON** ⇒ 原样返回，**连数组也原样返回**。
 *    如果这里直接跳到第 3 档的「第一个 `{` 到最后一个 `}`」，
 *    模型返回 `[{...}]` 时外层数组会被切掉，里面那个对象于是顺利通过校验 ——
 *    **一次形状错误被伪装成一次成功**。让整体先过，数组就会如实落到 schema 上被拒。
 * 2. markdown 代码围栏内的内容。模型被要求「只返回 JSON」时仍常常加围栏。
 * 3. 第一个 `{` 到最后一个 `}`：兜住「前后带解释文字」这个最常见的坏形态。
 */
export function extractJsonCandidate(raw: string): string | null {
  const text = raw.replace(/^\uFEFF/, '').trim()
  if (text === '') return null

  if (isWholeJsonValue(text)) return text

  const fence = /```(?:json|JSON)?\s*\n([\s\S]*?)```/.exec(text)
  if (fence?.[1] !== undefined) {
    const inner = fence[1].trim()
    if (inner !== '') return inner
  }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) return text.slice(start, end + 1)

  return null
}

const MAX_REPORTED_ISSUES = 5

/** 解析 + 校验。永不抛错 —— 失败是一种返回值。 */
export function parseStructured<T>(raw: string, schema: ZodType<T>): ParseResult<T> {
  const candidate = extractJsonCandidate(raw)

  if (candidate === null) {
    const isEmpty = raw.trim() === ''
    return {
      ok: false,
      failure: {
        code: isEmpty ? 'empty_response' : 'no_json_found',
        detail: isEmpty ? '模型返回了空内容' : '回复中找不到 JSON 对象',
        feedback: isEmpty
          ? '上一条回复是空的。请直接输出符合 schema 的 JSON 对象，不要输出任何其它内容。'
          : '上一条回复里找不到 JSON 对象。请只输出一个 JSON 对象，不要写解释文字，也不要使用 markdown 代码围栏。',
      },
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      failure: {
        code: 'invalid_json',
        detail: `JSON 语法错误：${message}`,
        feedback: `上一条回复不是合法 JSON（${message}）。请重新输出一个完整的 JSON 对象，注意引号、逗号与括号必须配对。`,
      },
    }
  }

  const result = schema.safeParse(parsed)
  if (result.success) return { ok: true, value: result.data }

  const issues = result.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.length === 0 ? '<根对象>' : issue.path.join('.')
    return `${path}: ${issue.message}`
  })
  const more = result.error.issues.length - issues.length

  return {
    ok: false,
    failure: {
      code: 'schema_mismatch',
      detail: `结构不符合 schema（${result.error.issues.length} 处问题）：${issues.join('；')}`,
      feedback:
        `上一条回复的 JSON 结构不符合 schema。问题：${issues.join('；')}` +
        (more > 0 ? `（另有 ${more} 处未列出）` : '') +
        '。请严格按 schema 补齐字段与类型，不要增删字段。',
    },
  }
}
