/**
 * HTML 渲染 —— 纯字符串输出，零 DOM。
 *
 * core 不能碰 `document`，所以渲染的产物是**一段 HTML 文本**，由 Web 端
 * 决定怎么放进页面或转成 PDF。这看起来像是被约束逼出来的设计，
 * 但它带来一个真实的好处：渲染产物可以在 Node 里被断言。
 * 「ATS 可解析」这件事于是在 CI 上可验证，而不需要跑一个浏览器。
 *
 * ## 排版纪律
 *
 * T4a 的全部验收标准建立在**「阅读顺序 == DOM 顺序」**这个前提上。
 * 一旦引入分栏，PDF 的文本层顺序就取决于渲染引擎的阅读顺序推断，
 * 而那件事没有一个简历工具扛得住。所以：**单栏、无绝对定位、无表格布局**。
 * 禁止清单见 `FORBIDDEN_LAYOUT_PATTERNS`，T4c 会照着它写断言。
 */

import { escapeHtml as escape } from './escape'
import type { DocumentEntry, DocumentModel, DocumentSection } from './model'

/**
 * 被禁止的排版手段。**这不是风格偏好，是正确性约束** ——
 * 每一项都会破坏「阅读顺序 == DOM 顺序」，或让 ATS 抽不到文本。
 */
export const FORBIDDEN_LAYOUT_PATTERNS: readonly string[] = Object.freeze([
  'column-count',
  'columns:',
  'float:',
  'position:absolute',
  'position: absolute',
  'position:fixed',
  'position: fixed',
  'display:grid',
  'display: grid',
  'display:table',
  'display: table',
])

const STYLES = `
:root { color: #000; background: #fff; }
body { font-family: -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; margin: 0 auto; max-width: 210mm; padding: 14mm; }
h1 { font-size: 18pt; margin: 0 0 2pt; font-weight: 600; }
.label { font-size: 11pt; margin: 0 0 6pt; }
.contacts { list-style: none; padding: 0; margin: 0 0 10pt; font-size: 10pt; }
.contacts li { display: inline; margin-right: 10pt; }
h2 { font-size: 12pt; margin: 12pt 0 6pt; border-bottom: 1px solid #000; padding-bottom: 2pt; }
.entry { margin: 0 0 8pt; }
.entry h3 { font-size: 11pt; margin: 0; font-weight: 600; }
.meta { font-size: 10pt; margin: 1pt 0 0; }
ul { margin: 2pt 0 0; padding-left: 14pt; }
li { margin: 1pt 0; }
`.trim()

function renderEntry(entry: DocumentEntry): string {
  const parts = [`<div class="entry">`, `<h3>${escape(entry.heading)}</h3>`]
  if (entry.meta.length > 0) {
    parts.push(`<p class="meta">${escape(entry.meta.join(' · '))}</p>`)
  }
  if (entry.bullets.length > 0) {
    parts.push('<ul>')
    for (const bullet of entry.bullets) parts.push(`<li>${escape(bullet)}</li>`)
    parts.push('</ul>')
  }
  parts.push('</div>')
  return parts.join('\n')
}

function renderSection(section: DocumentSection): string {
  return [
    `<section id="${escape(section.id)}">`,
    `<h2>${escape(section.heading)}</h2>`,
    ...section.entries.map(renderEntry),
    '</section>',
  ].join('\n')
}

/**
 * 渲染成一份完整的 HTML 文档。
 *
 * 注意 `name` 与 `contacts` 直接来自 `DocumentModel` —— 它们在这里被
 * **逐字写进产出物**，这正是 DESIGN 1.3 说的「由确定性代码注入」。
 * 模型从未见过它们，而用户打印出来的简历上有它们。这条链路的正确性
 * 由 `render/ats.test.ts` 里「B 级字段必须出现在产物中」的断言守着。
 */
export function renderHtml(model: DocumentModel): string {
  const htmlLang = model.lang === 'zh' ? 'zh-CN' : 'en'

  const head = [
    '<!DOCTYPE html>',
    `<html lang="${htmlLang}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escape(model.name)}</title>`,
    `<style>${STYLES}</style>`,
    '</head>',
  ]

  const body: string[] = ['<body>']
  body.push(`<h1>${escape(model.name)}</h1>`)
  if (model.label !== '') body.push(`<p class="label">${escape(model.label)}</p>`)
  if (model.contacts.length > 0) {
    body.push('<ul class="contacts">')
    for (const line of model.contacts) {
      body.push(`<li>${escape(line.label)}：${escape(line.value)}</li>`)
    }
    body.push('</ul>')
  }
  if (model.summary !== '') body.push(`<p class="summary">${escape(model.summary)}</p>`)
  for (const section of model.sections) body.push(renderSection(section))
  body.push('</body>', '</html>')

  return [...head, ...body].join('\n')
}
