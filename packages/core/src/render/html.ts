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
 *
 * ## 交给打印引擎的那一半：`@page`
 *
 * 屏幕上「一页简历」靠 `padding` 模拟，打印 / 转 PDF 时那层模拟必须换成
 * 真正的分页边距 —— 否则第二页起不会有上边距，而且 `padding` 只在文档
 * 首尾生效，正文会贴到纸边。所以有一条 `@page { size: A4; margin: 14mm }`：
 * 它让**每一页**都自带页边距，也让正文宽度从「`max-width` 与 padding 相加」
 * 这个说不清的数字，变成可计算的一个：210 − 2×14 = 182mm。
 *
 * 这个数字不是装饰 —— `layout.ts` 的页数估算就以它为可用宽度。
 * 两处若不一致，估算出来的行数会系统性地偏一边。
 *
 * @see DESIGN 10.1 · TASKS.md T4a / T4b / T4c
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

/**
 * 样式表。**这里的每个数字都与 `layout.ts` 的 `CAMPUS_LAYOUT` 成对存在**，
 * 对应关系由 `paginate.test.ts` 的漂移断言钉住。
 *
 * 导出它只有一个原因：让「CSS 与版式常量同步」这件事**可以被断言**。
 * 不导出时，改动 CSS 里的字号在测试里是完全静默的。
 */
export const RESUME_STYLES = `
@page { size: A4; margin: 14mm; }
:root { color: #000; background: #fff; }
body { font-family: -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; margin: 0 auto; width: 182mm; }
@media screen { body { padding: 14mm 0; } }
h1 { font-size: 18pt; margin: 0 0 2pt; font-weight: 600; }
.label { font-size: 11pt; margin: 0 0 6pt; }
.contacts { list-style: none; padding: 0; margin: 0 0 10pt; font-size: 10pt; }
.contacts li { display: inline; margin-right: 10pt; }
.summary { margin: 6pt 0; }
h2 { font-size: 12pt; margin: 12pt 0 6pt; border-bottom: 1px solid #000; padding-bottom: 2pt; }
.entry { margin: 0 0 8pt; }
.entry h3 { font-size: 11pt; margin: 0; font-weight: 600; }
.meta { font-size: 10pt; margin: 1pt 0 0; }
ul { margin: 2pt 0 0; padding-left: 14pt; }
li { margin: 1pt 0; }
.page-break { break-before: page; page-break-before: always; }
`.trim()

/**
 * 联系方式的「标签 — 值」分隔符。
 *
 * 中文用全角冒号，英文用半角冒号加空格。**这不是排版偏好，是目标语规范**
 * （DESIGN 10.1）：英文简历里出现 `Email：foo@bar.com` 这种全角标点，
 * 是「中文模板套英文内容」最典型的痕迹，而它恰恰是这份文档要避免的事。
 *
 * 顺带一提，它也是中英两版文本**天然独立**的来源之一 —— 见
 * `package.ts` 里 `CrossLanguageParity.independentCn / independentEn`
 * 为什么要区分「逐字相同的文本」与「各自不同的文本」。
 */
function contactSeparator(lang: DocumentModel['lang']): string {
  return lang === 'zh' ? '：' : ': '
}

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
 * 渲染一份文档的 `<body>` 内容（不含 `<html>` / `<head>`）。
 *
 * 拆出来是因为**双语版必须是「一份文档」**：把两份完整 HTML 首尾相接会得到
 * 两个 `<html>` / 两个 `<body>`，浏览器能容错渲染，而 pdfjs 与各类 ATS
 * 解析器不一定。所以双语版共用一套 head，只把两段 body 拼起来 ——
 * 这个函数就是那两段 body 的唯一产地。
 *
 * 注意 `name` 与 `contacts` 直接来自 `DocumentModel` —— 它们在这里被
 * **逐字写进产出物**，这正是 DESIGN 1.3 说的「由确定性代码注入」。
 * 模型从未见过它们，而用户打印出来的简历上有它们。这条链路的正确性
 * 由 `render/ats.test.ts` 里「B 级字段必须出现在产物中」的断言守着。
 */
export function renderBody(model: DocumentModel): string {
  const body: string[] = []
  body.push(`<h1>${escape(model.name)}</h1>`)
  if (model.label !== '') body.push(`<p class="label">${escape(model.label)}</p>`)
  if (model.contacts.length > 0) {
    const separator = contactSeparator(model.lang)
    body.push('<ul class="contacts">')
    for (const line of model.contacts) {
      body.push(`<li>${escape(line.label)}${separator}${escape(line.value)}</li>`)
    }
    body.push('</ul>')
  }
  if (model.summary !== '') body.push(`<p class="summary">${escape(model.summary)}</p>`)
  for (const section of model.sections) body.push(renderSection(section))
  return body.join('\n')
}

function renderDocument(title: string, htmlLang: string, bodies: readonly string[]): string {
  const head = [
    '<!DOCTYPE html>',
    `<html lang="${htmlLang}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escape(title)}</title>`,
    `<style>${RESUME_STYLES}</style>`,
    '</head>',
  ]
  return [...head, '<body>', ...bodies, '</body>', '</html>'].join('\n')
}

/** 渲染成一份完整的 HTML 文档。 */
export function renderHtml(model: DocumentModel): string {
  return renderDocument(
    model.name,
    model.lang === 'zh' ? 'zh-CN' : 'en',
    [renderBody(model)],
  )
}

/**
 * 顺序拼页的双语版：**EN 在前，CN 在后，不并排**（DESIGN 10.1）。
 *
 * 两处细节都不是可选的：
 *
 * - **每个半页自带 `lang` 属性。** 根节点只能声明一种语言，把英文内容
 *   挂在 `lang="en"` 的文档里而中文半页不加标记，会让屏幕阅读器与
 *   拼写检查按英文规则读中文，也会让 ATS 的语种判定出错。
 * - **断页放在 CN 半页上（`break-before`），不是放在 EN 半页后面。**
 *   语义上「这一半要从新页开始」属于后一半；而且文档以断页属性结尾时，
 *   部分渲染引擎会多吐一张空白页。
 */
export function renderBilingualHtml(
  parts: readonly [DocumentModel, DocumentModel],
): string {
  const [first, second] = parts
  const bodies = [
    `<div class="half" lang="${first.lang === 'zh' ? 'zh-CN' : 'en'}">\n${renderBody(first)}\n</div>`,
    `<div class="half page-break" lang="${second.lang === 'zh' ? 'zh-CN' : 'en'}">\n${renderBody(second)}\n</div>`,
  ]
  return renderDocument(first.name, first.lang === 'zh' ? 'zh-CN' : 'en', bodies)
}
