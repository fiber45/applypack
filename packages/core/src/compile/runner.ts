/**
 * 有限重试守门 —— 「坏 JSON 率 = 0」的实现。
 *
 * 这件事的关键在于**把失败的位置说清楚**：坏 JSON 不是被消灭了，是被
 * **逼到了边界上**。runner 的契约是二值的：
 *
 *   通过 schema 校验的对象  ←→  CompileError
 *
 * 没有第三种返回。这就是「坏 JSON 率 = 0」的可断言形式 —— 它不承诺模型
 * 每次都对，它承诺**错误不会以半成品的形态继续往下走**。
 *
 * 重试的反馈是结构化的（DESIGN 8.5）：模型拿到的是
 * 「`skills.0.evidence`: Required」，而不是「写得不太对」。
 * 前者一次就能修对，后者只会让它换个说法再错一次。
 */

import type { ZodType } from 'zod'

import { callLLM, type LLMClient, type LLMMessage } from '../egress/index'
import type { ArchiveV1 } from '../schema/index'
import { CompileError } from './errors'
import { parseStructured, type ParseFailure } from './parse'

export const DEFAULT_MAX_ATTEMPTS = 3

/**
 * 回显给模型的上一轮原文的长度上限。
 *
 * 取舍：不截断时，一次坏输出会让后续每次重试的输入都膨胀一份；
 * 截断则可能砍掉模型判断自己错在哪所需的信息。
 * 取 4000 是因为编译产物本身是结构化短文本，超出的部分基本是模型在跑题 ——
 * 而跑题的输出，恰恰是最不需要被完整回显的那类。
 */
const MAX_ECHO_CHARS = 4000

export interface CompileRequest<T> {
  readonly client: LLMClient
  readonly model: string
  /** 系统提示：角色 + 硬约束 + schema 说明 */
  readonly system: string
  /** 本轮任务：JD 原文或经历原文 */
  readonly task: string
  readonly schema: ZodType<T>
  /**
   * schema 之后的第二道闸门。
   *
   * schema 能保证形状，保证不了含义 —— `numbers` 是个合法字符串数组，
   * 但它可以是模型编的。把语义检查挂在这里而不是放在返回之后，是为了让它
   * **也成为重试的理由**：一个能被自动纠正的错误，没有理由变成一次崩溃。
   */
  readonly validate?: (value: T) => ParseFailure | null
  readonly reference?: string
  readonly archive?: ArchiveV1
  readonly maxAttempts?: number
}

function echoOf(raw: string): string {
  return raw.length <= MAX_ECHO_CHARS ? raw : `${raw.slice(0, MAX_ECHO_CHARS)}\n…（已截断）`
}

/**
 * 编译一次，失败则带着结构化反馈重试，直到通过或耗尽次数。
 *
 * `maxAttempts` 下限为 1 且**强制取整**：传 0 或负数会让循环一次都不执行，
 * 函数会带着一个从未被赋值的 `lastFailure` 走到抛错语句 —— 那是崩溃而非失败。
 * 与其在文档里写「请传正整数」，不如在这里收敛掉。
 */
export async function compileStructured<T>(request: CompileRequest<T>): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(request.maxAttempts ?? DEFAULT_MAX_ATTEMPTS))
  const volatile: LLMMessage[] = [{ role: 'user', content: request.task }]

  let lastFailure: ParseFailure | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await callLLM(request.client, {
      model: request.model,
      system: request.system,
      ...(request.reference === undefined ? {} : { reference: request.reference }),
      ...(request.archive === undefined ? {} : { archive: request.archive }),
      volatile,
    })

    const parsed = parseStructured(response.text, request.schema)

    // 先过 schema，再过语义闸门。顺序不能反：语义闸门读的是已经确定形状的对象。
    let failure: ParseFailure | null = parsed.ok ? null : parsed.failure
    if (parsed.ok && request.validate !== undefined) {
      failure = request.validate(parsed.value)
    }
    if (parsed.ok && failure === null) return parsed.value

    /* c8 ignore next */
    if (failure === null) throw new Error('编译既未成功也未产出失败原因 —— 不该到达的分支')
    lastFailure = failure

    if (attempt < maxAttempts) {
      volatile.push({ role: 'assistant', content: echoOf(response.text) })
      volatile.push({ role: 'user', content: failure.feedback })
    }
  }

  /* c8 ignore next */
  if (lastFailure === undefined) {
    throw new Error('编译循环未执行 —— 这是一个不该到达的分支')
  }
  throw new CompileError(lastFailure, maxAttempts)
}
