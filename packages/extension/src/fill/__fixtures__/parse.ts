import { JSDOM } from 'jsdom'

import { asDomDocument, type DomDocument } from '../dom'

/**
 * 把保存下来的 HTML fixture 解析成 `DomDocument`。
 *
 * 这里是**测试专用的 DOM 接缝**：生产环境里内容脚本传进来的是真实 DOM，
 * 测试里是 jsdom —— 两者都只需满足 `dom.ts` 的最小结构接口。
 * `asDomDocument` 内部做运行时形状检查（正控），不是裸 cast。
 */
export function parseHtmlFixture(html: string): DomDocument {
  const dom = new JSDOM(html, { url: 'https://fixtures.applypack.test/form' })
  return asDomDocument(dom.window.document)
}
