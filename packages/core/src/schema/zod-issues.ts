/**
 * 把 zod 的校验错误压成一行一条的可读文本。
 *
 * 存在的理由：schema 是严格模式，解码失败会经常发生在「用户手改过档案」这类场景，
 * 报错必须能直接指出是哪个字段出了问题 —— 否则用户只会看到一句「格式不对」。
 */

interface ZodIssueLike {
  readonly path: readonly PropertyKey[]
  readonly message: string
}

export function describeZodIssues(error: { readonly issues: readonly ZodIssueLike[] }): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join('.')
    return path === '' ? issue.message : `${path} — ${issue.message}`
  })
}
