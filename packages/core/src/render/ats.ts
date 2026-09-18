/**
 * ATS 文本抽取 —— 「ATS 可解析」这条声明的执行者。
 *
 * ## 这份实现的边界，必须先说清楚
 *
 * 真实的 ATS 解析的是 **PDF 的文本层**，不是 HTML。本文件抽的是 HTML 的文本，
 * 两者之间隔着一个转换步骤（HTML → PDF），而那个步骤需要浏览器环境 ——
 * `core` 不能碰 DOM，所以它不在本层，而在 Web 端（`T4a` 未完成的部分）。
 *
 * **这个缺口是有边界的，而且边界被论证过**：
 *
 *   本层的断言成立 ⇒ 内容齐全、顺序正确、文本不依赖样式表达
 *   它**不**保证 ⇒ PDF 生成器没有把文本层搞乱
 *
 * 后者的风险被 `FORBIDDEN_LAYOUT_PATTERNS` 压到很低：只要渲染产物是单栏、
 * 无绝对定位、无表格布局，那么「阅读顺序 == DOM 顺序」是排版引擎的必然行为，
 * 而不是一个需要碰运气的事情。**分栏才是文本层错乱的唯一常见来源** ——
 * 而它被一条断言挡住了。
 *
 * 所以这不是「用 HTML 冒充 PDF 然后宣称 ATS 友好」，是
 * **把不可测的那一小块（PDF 生成器）隔离在一套可测的约束之外**。
 * 剩下的风险由 Web 端接入 pdfjs 后补上（见 `TASKS.md` T4a 的未完成项）。
 */

import { decodeEntities } from './escape'

/** 结束即换行的块级标签。命中它们要插入换行，否则所有内容会粘成一行。 */
const BLOCK_CLOSERS =
  /<\/(?:p|div|li|ul|ol|h1|h2|h3|h4|h5|h6|section|header|footer|article|tr|td)\s*>/gi

/** 元素之间不产生换行的标签（行内元素）。它们的闭合不该断行。 */
function stripDocumentChrome(html: string): string {
  return html
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<head[\s\S]*?<\/head>/i, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
}

/**
 * 抽取可见文本，一行一个块。
 *
 * 保留换行是刻意的：ATS 判定「公司名与日期是否在同一条目里」靠的就是行的邻近关系，
 * 把所有空白压成一个空格会让这个信息彻底消失。
 */
export function extractText(html: string): string {
  const body = stripDocumentChrome(html)
  const withBreaks = body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_CLOSERS, '\n')

  return decodeEntities(withBreaks.replace(/<[^>]+>/g, ''))
    .split('\n')
    .map((line) => line.replace(/[ \t\u3000]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
}

/** 抽取后的行数组，方便逐行断言顺序。 */
export function extractLines(html: string): readonly string[] {
  const text = extractText(html)
  return text === '' ? [] : text.split('\n')
}

/**
 * 某个字段在文本里出现的位置（行号），未出现返回 -1。
 *
 * 断言「姓名在联系方式之前」不能靠子串位置 —— 子串位置在单行里是对的，
 * 但跨行比较需要行号。行号也让失败信息可读：「第 3 行 vs 第 12 行」。
 */
export function lineOf(lines: readonly string[], needle: string): number {
  return lines.findIndex((line) => line.includes(needle))
}

/** 全部未在文本中找到的必备字段。空数组表示 ATS 需要的字段齐全。 */
export function missingFields(html: string, required: readonly string[]): readonly string[] {
  const text = extractText(html)
  return required.filter((field) => !text.includes(field))
}
