import { archiveV1Schema, type ArchiveV1 } from './archive'
import { describeZodIssues } from './zod-issues'

/**
 * 档案的序列化 / 反序列化。
 *
 * 密文库存的就是这里产出的字符串（再经 XChaCha20-Poly1305 加密，见 ADR-9），
 * 所以这一层的正确性要求是：
 * **解码失败必须显式抛错，绝不能返回部分数据或带默认值的半成品。**
 * 一份悄悄被补全或截断的档案，比一次明确的失败危险得多 ——
 * 用户会以为数据还在，而实际上已经丢了。
 *
 * @see AGENTS.md §5 红线 2
 */

export class ArchiveDecodeError extends Error {
  readonly issues: readonly string[]

  constructor(message: string, issues: readonly string[] = []) {
    super(issues.length === 0 ? message : `${message}：${issues.join('；')}`)
    this.name = 'ArchiveDecodeError'
    this.issues = issues
  }
}

/** 序列化。先过一遍校验，避免把不合法对象写进密文库。 */
export function serializeArchive(archive: ArchiveV1): string {
  return JSON.stringify(archiveV1Schema.parse(archive))
}

export function deserializeArchive(serialized: string): ArchiveV1 {
  let raw: unknown
  try {
    raw = JSON.parse(serialized)
  } catch (cause) {
    throw new ArchiveDecodeError('档案不是合法 JSON', [String(cause)])
  }

  const parsed = archiveV1Schema.safeParse(raw)
  if (!parsed.success) {
    throw new ArchiveDecodeError('档案不符合 v1 schema', describeZodIssues(parsed.error))
  }
  return parsed.data
}
