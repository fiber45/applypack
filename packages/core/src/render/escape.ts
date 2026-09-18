/**
 * HTML 实体编解码。
 *
 * 单独成文件是因为**两个方向都必须存在，而且必须互逆**：
 * 渲染时转义（否则用户简历里的 `<` 会破坏结构），
 * ATS 抽取时反转义（否则抽出来的文本里满是 `&amp;`）。
 *
 * 如果只有转义没有反转义，测试会通过而真实产物是坏的 ——
 * 抽取器自己把 `&amp;` 还原了，于是断言看不到问题。
 * 所以两个函数放在一起，且有一条往返断言。
 */

const ESCAPES: readonly (readonly [RegExp, string])[] = Object.freeze([
  [/&/g, '&amp;'],
  [/</g, '&lt;'],
  [/>/g, '&gt;'],
  [/"/g, '&quot;'],
  [/'/g, '&#39;'],
])

const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|#39|nbsp);/g
const UNESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
})

/** 转义。`&` 必须最先处理，否则后面的替换会把刚生成的实体再转一遍。 */
export function escapeHtml(text: string): string {
  let out = text
  for (const [pattern, replacement] of ESCAPES) out = out.replace(pattern, replacement)
  return out
}

/** 反转义。一次扫描完成，避免 `&amp;lt;` 这类双重编码被解成 `<`。 */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (match) => UNESCAPES[match] ?? match)
}
