/**
 * 经历编译 —— 管线第 1 步。
 *
 * 输入是自由文本（用户从旧简历粘来的一段），输出是结构化的经历条目。
 *
 * **这一层最重要的不是抽取质量，是 `sourceText` 的忠实度。**
 * DESIGN 8.2：原始数字一旦在预处理阶段丢失，幻觉校验就永远失效。
 * 而「模型顺手把 sourceText 润色了一下」这件事不会有任何症状 ——
 * 编译产物看起来更整齐了，下游的 `untraceableNumbers` 却从此以一份
 * **已经被改写的「原文」**为基准，于是它永远说「没问题」。
 *
 * 所以这里的 `validate` 干两件事，都是确定性的字符串比对：
 *   1. `sourceText` 必须是输入原文的片段（不是重写、不是翻译、不是摘要）
 *   2. `numbers` 里的每个数字都必须真实出现在该条的 `sourceText` 中
 *
 * 两者都作为**重试理由**接入，而不是在返回之后单独抛错 —— 一个能被自动纠正的
 * 错误，没有理由变成一次崩溃。
 */

import { z } from 'zod'

import type { LLMClient } from '../egress/index'
import type { ArchiveV1 } from '../schema/index'
import { untraceableNumbers } from '../verify/numbers'
import { isGroundedIn } from '../verify/trace'
import type { ParseFailure } from './parse'
import { compileStructured } from './runner'
import { compiledExperienceSchema, type CompiledExperience } from './schemas'

const SHAPE = JSON.stringify(z.toJSONSchema(compiledExperienceSchema), null, 2)

export const EXPERIENCE_SYSTEM_PROMPT = `你是一个简历经历解析器。你的唯一职责是把一段自由文本形式的经历描述，切分成结构化条目。

硬约束：
1. 只输出一个 JSON 对象。不要输出解释文字，不要使用 markdown 代码围栏。
2. **sourceText 必须逐字复制输入文本中的原句。** 不得改写、不得润色、不得翻译、不得缩写、不得补全。它是后续事实校验的唯一参照物 —— 一旦它被改动，校验就永远失去意义。
3. numbers 只能列出该条 sourceText 中**真实出现**的数字（含小数、百分号前的数值、日期中的数字）。不要推断、不要计算、不要换算单位。
4. 输入中无法归入任何条目的内容，直接跳过，不要硬塞。
5. 时间统一为 YYYY-MM；原文只给年份时用 YYYY-01；缺失填 null。不要用空字符串。
6. 输出必须严格符合下面的 schema。不得增加、删除或改名任何字段。

schema 形状：
${SHAPE}`

export interface CompileExperienceOptions {
  readonly client: LLMClient
  readonly model: string
  readonly rawText: string
  /** 已有档案（可选）。仅在需要模型参照既有信息时传入；不传则上下文里没有用户数据。 */
  readonly archive?: ArchiveV1
  readonly reference?: string
  readonly maxAttempts?: number
}

/**
 * 语义闸门：结构合法之后，检查「逐字保留」这条承诺有没有被兑现。
 *
 * 返回 `ParseFailure` 而不是抛错，是因为它要作为重试反馈回到模型手上 ——
 * 见 runner.ts 里对 `validate` 的说明。
 */
function traceabilityGate(rawInput: string): (value: CompiledExperience) => ParseFailure | null {
  return (compiled) => {
    for (let index = 0; index < compiled.entries.length; index += 1) {
      const entry = compiled.entries[index]
      /* c8 ignore next */
      if (entry === undefined) continue

      if (!isGroundedIn(entry.sourceText, rawInput)) {
        return {
          code: 'validation_failed',
          detail: `第 ${index + 1} 条的 sourceText 不是输入原文的片段`,
          feedback:
            `第 ${index + 1} 条的 sourceText 不是输入原文的片段。` +
            'sourceText 必须逐字复制输入文本中的原句，不能改写、翻译、缩写或补全。' +
            '请修正后重新输出完整的 JSON。',
        }
      }

      const offenders = untraceableNumbers(entry.numbers.join(' '), [entry.sourceText])
      if (offenders.length > 0) {
        return {
          code: 'validation_failed',
          detail: `第 ${index + 1} 条的 numbers 含 sourceText 中不存在的数字：${offenders.join('、')}`,
          feedback:
            `第 ${index + 1} 条的 numbers 里出现了 sourceText 中不存在的数字（${offenders.join('、')}）。` +
            'numbers 只能列出该条 sourceText 中真实出现的数字。请修正后重新输出完整的 JSON。',
        }
      }
    }
    return null
  }
}

/** 把自由文本经历编译成结构化条目。 */
export function compileExperience(options: CompileExperienceOptions): Promise<CompiledExperience> {
  return compileStructured({
    client: options.client,
    model: options.model,
    system: EXPERIENCE_SYSTEM_PROMPT,
    schema: compiledExperienceSchema,
    validate: traceabilityGate(options.rawText),
    task: `以下是经历描述原文，请把它切分为结构化条目。\n\n<resume>\n${options.rawText}\n</resume>`,
    ...(options.reference === undefined ? {} : { reference: options.reference }),
    ...(options.archive === undefined ? {} : { archive: options.archive }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
  })
}
