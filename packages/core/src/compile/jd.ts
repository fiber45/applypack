/**
 * JD 编译 —— 管线第 2 步。
 *
 * 输入是岗位描述原文，输出是 `CompiledJd`。它**不接触用户档案**：
 * 这次请求的上下文里没有任何用户数据，因此 `archive` 不传。
 *
 * 之所以把 prompt 与 schema 绑在一起生成（而不是各写一份），是因为
 * 它们必然会发生漂移：改了 schema 忘了改 prompt，模型就会一直按旧形状输出，
 * 而 schema 校验会一直拒绝 —— 症状是「模型能力不行」，实际是两份文档不同步。
 * 从 schema 生成 prompt 里的形状说明，这个漂移在结构上就不可能发生。
 */

import { z } from 'zod'

import type { LLMClient } from '../egress/index'
import { compileStructured } from './runner'
import { compiledJdSchema, type CompiledJd } from './schemas'

const SHAPE = JSON.stringify(z.toJSONSchema(compiledJdSchema), null, 2)

export const JD_SYSTEM_PROMPT = `你是一个岗位描述（JD）解析器。你的唯一职责是把 JD 原文转换成结构化字段。

硬约束：
1. 只输出一个 JSON 对象。不要输出解释文字，不要使用 markdown 代码围栏。
2. 所有文本字段必须**逐字取自 JD 原文**。不得改写、不得润色、不得补充 JD 中没有的信息。
3. evidence 字段必须是 JD 中包含该技能的原句（可以是原句的一部分）。JD 中找不到明确依据的技能，不要列出。
4. JD 未提及的字段：字符串填 null，数组填 []。不要用「无」「N/A」「未知」之类的占位文本 —— 那会让下游无法区分「没有」与「写了个占位符」。
5. 输出必须严格符合下面的 schema。不得增加、删除或改名任何字段。

字段判据：
- strict：硬性要求（「必须」「要求」「须」「限」）填 true；加分项（「优先」「加分」「有…者更佳」）填 false。这个判断会影响筛选结果，不是措辞偏好。
- proficiency：「精通 / 深入了解」→ expert；「熟悉 / 熟练 / 掌握」→ proficient；「了解 / 接触过」→ familiar。
- register：技术岗 technical；正式公文体 formal；商业销售类 business；口语化或创业团队 casual。
- language：JD 正文的语种，中英混排填 mixed。

schema 形状：
${SHAPE}`

export interface CompileJdOptions {
  readonly client: LLMClient
  readonly model: string
  readonly jdText: string
  readonly reference?: string
  readonly maxAttempts?: number
}

/** 把 JD 原文编译成结构化字段。 */
export function compileJd(options: CompileJdOptions): Promise<CompiledJd> {
  return compileStructured({
    client: options.client,
    model: options.model,
    system: JD_SYSTEM_PROMPT,
    schema: compiledJdSchema,
    task: `以下是岗位描述原文，请把它编译为结构化字段。\n\n<jd>\n${options.jdText}\n</jd>`,
    ...(options.reference === undefined ? {} : { reference: options.reference }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
  })
}
