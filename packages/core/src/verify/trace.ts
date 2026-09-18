/**
 * 溯源比对 —— 判断一段文本是否「有据可依」。
 *
 * 与 `numbers.ts` 的分工：`numbers.ts` 管**数字**，本文件管**整段文本**。
 * 两者是同一个判据的两级粒度：数字是幻觉最常见的形态（也是破坏力最大的，
 * 因为它看起来最具体），但把整句原文换成一句漂亮的假话，同样不可接受。
 */

/**
 * 折叠空白：把换行、制表、全角空格、连续空格统一成单个半角空格。
 *
 * 为什么不做更激进的归一化（去掉标点、繁简转换）：溯源判据必须是
 * **「模型能否被判定为忠实」**，而不是「我们能多宽容」。归一化越激进，
 * 通过的篡改就越多 —— 把「提升 40%」和「提升 40 %」判为相同是对的，
 * 把它们和「提升 4 0%」判为相同则会让闸门失去意义。
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/[\s\u3000]+/g, ' ').trim()
}

/**
 * `text` 是否是 `source` 的一段（空白归一化后）。
 *
 * 用于验证「逐字保留」这类承诺：编译产物里的 `sourceText` 必须能在
 * 输入原文里找得到。找不到就说明模型改写了它 —— 而 `sourceText` 一旦被改写，
 * 下游的幻觉校验就失去了参照物，整条溯源链静默失效。
 */
export function isGroundedIn(text: string, source: string): boolean {
  const needle = normalizeWhitespace(text)
  if (needle === '') return true
  return normalizeWhitespace(source).includes(needle)
}
