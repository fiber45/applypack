import { describe, expect, it } from 'vitest'

import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import { campusArchiveV1, campusRewritten } from './__fixtures__/campus-archive'
import { normalizeCss, scanForbiddenLayout, splitTexts, stitchReport, styleSurface } from './format'
import { buildDeliveryPackage } from './package'

const CLEAN = buildDeliveryPackage(campusArchiveV1, { rewritten: campusRewritten })
const MAXIMAL = buildDeliveryPackage(maximalArchiveV1)

const EN = CLEAN.views.en.texts
const CN = CLEAN.views.cn.texts

/**
 * 手工构造的违规产物。**每一项都是一条真实的走歪路径**，
 * 而不是随机字符串：
 *
 * - 前四条是「把双语两半并排」的四种常见写法（有人会觉得并排省纸）；
 * - `table` 一条是模板作者最容易想到的「对齐日期」手段；
 * - 最后三条是「产物不再自包含」。
 *
 * 用它们**反向验证**扫描器：一个从没见过违规产物的扫描器，
 * 它的 `[]` 与「根本没在跑」无法区分（T1.4 的教训）。
 */
const VIOLATING: readonly (readonly [string, string, string])[] = Object.freeze([
  ['column-count 分栏', '<style>.half { column-count: 2; }</style>', 'column-count'],
  ['大写与空白都不同的写法', '<style>.half { COLUMN-COUNT : 2 }</style>', 'column-count'],
  ['columns 简写', '<style>.half { columns: 2; }</style>', 'columns:'],
  ['flex 并排', '<style>.half { display: flex; }</style>', 'display:flex'],
  ['行内 flex', '<div style="display:inline-flex"></div>', 'display:inline-flex'],
  ['grid 并排', '<style>.half { display: grid; grid-template-columns: 1fr 1fr; }</style>', 'display:grid'],
  ['绝对定位', '<style>.half { position: absolute; }</style>', 'position:absolute'],
  ['浮动', '<style>.half { float: left; }</style>', 'float:'],
  ['表格布局', '<table><tr><td>a</td></tr></table>', '<table'],
  ['display:table', '<style>.x { display: table; }</style>', 'display:table'],
  ['外部样式表', '<link rel="stylesheet" href="resume.css">', '<link'],
  ['外部引入', '<style>@import url("resume.css");</style>', '@import'],
  ['可执行内容', '<script>alert(1)</script>', '<script'],
])

describe('T4c · 顺序拼页：双语版必须逐字等于 EN ++ CN', () => {
  it('真实产物通过', () => {
    const report = stitchReport(CLEAN.views.bilingual.texts, EN, CN)
    expect(report.ok).toBe(true)
    expect(report.missing).toEqual([])
    expect(report.extra).toEqual([])
    expect(report.firstMismatch).toBeNull()
    expect(report.expectedLines).toBe(EN.length + CN.length)
    expect(report.actualLines).toBe(EN.length + CN.length)
  })

  it('两份样本的产物都通过（不是只有那一个小样本才对）', () => {
    const report = stitchReport(MAXIMAL.views.bilingual.texts, MAXIMAL.views.en.texts, MAXIMAL.views.cn.texts)
    expect(report.ok).toBe(true)
    expect(report.expectedLines).toBeGreaterThan(EN.length + CN.length)
  })

  it('少拼了尾部 ⇒ `missing` 非空，且**不是**顺序问题', () => {
    const truncated = [...EN, ...CN.slice(0, -1)]
    const report = stitchReport(truncated, EN, CN)
    expect(report.ok).toBe(false)
    expect(report.missing).toEqual([CN[CN.length - 1]])
    expect(report.extra).toEqual([])
    // 它是期望数组的前缀，所以逐位比较发现不了 —— 「缺行」必须单独算。
    expect(report.firstMismatch).toBeNull()
  })

  it('混进了额外一行 ⇒ `extra` 非空，而 `missing` 是空的', () => {
    const withStray = [...EN, ...CN, 'Page 1 of 2']
    const report = stitchReport(withStray, EN, CN)
    expect(report.ok).toBe(false)
    expect(report.extra).toEqual(['Page 1 of 2'])
    expect(report.missing).toEqual([])
    // 行数变了但前面对得上，所以逐位比较也没有错位。
    expect(report.firstMismatch).toBeNull()
  })

  it('顺序倒了 ⇒ `firstMismatch` 落在第 0 位', () => {
    const reversed = [...CN, ...EN]
    const report = stitchReport(reversed, EN, CN)
    expect(report.ok).toBe(false)
    expect(report.firstMismatch).toEqual({ index: 0, expected: EN[0], actual: CN[0] })
    expect(report.missing).toEqual([])
    expect(report.extra).toEqual([])
  })

  it('**行数相同、内容相同、只是后半内部被换过顺序 ⇒ 三个信号只剩 `firstMismatch`**', () => {
    // 这是本组里唯一一条不能靠 `missing` / `extra` 判出来的情形：
    // 多重集完全一致，行数也一致，所以前两个信号都是空的。
    // 若 `stitchReport` 只算 `missing` 与 `extra`，这一页会全绿通过。
    const head = CN[0] ?? ''
    const different = CN.findIndex((line) => line !== head)
    expect(different).toBeGreaterThan(0)

    const swapped = [...CN]
    swapped[0] = CN[different] ?? ''
    swapped[different] = head

    const report = stitchReport([...EN, ...swapped], EN, CN)
    expect(report.ok).toBe(false)
    expect(report.missing).toEqual([])
    expect(report.extra).toEqual([])
    expect(report.firstMismatch?.index).toBe(EN.length)
    expect(report.firstMismatch?.expected).toBe(head)
    expect(report.firstMismatch?.actual).toBe(CN[different])
  })
})

describe('T4c · 多重集相减（拼页判定的基础）', () => {
  it('重复行只抵消一次 —— 集合语义会让少拼一行查不出来', () => {
    // 页面上同一行出现两次是可能的（两条内容相同的要点）。用集合的话
    // 「另一侧也有一行」会把两次都抵消掉，于是少拼一行仍然报绿。
    const { leftOnly, shared } = splitTexts(['a', 'a'], ['a'])
    expect(shared).toEqual(['a'])
    expect(leftOnly).toEqual(['a'])
  })

  it('两侧相同 ⇒ 没有独有项', () => {
    const { leftOnly } = splitTexts(['a', 'b'], ['b', 'a'])
    expect(leftOnly).toEqual([])
  })

  it('空输入不抛错（`for` 循环里的空数组是上一次踩过的坑）', () => {
    expect(splitTexts([], []).leftOnly).toEqual([])
    expect(splitTexts(['a'], []).leftOnly).toEqual(['a'])
  })
})

describe('T4c · 单栏扫描：反向验证', () => {
  it('手工构造的违规产物每一项都必须被抓到，且报出**是哪一条**', () => {
    expect(VIOLATING.length).toBeGreaterThanOrEqual(10)
    for (const [label, html, expectedPattern] of VIOLATING) {
      const violations = scanForbiddenLayout(html)
      const patterns = violations.map((item) => item.pattern)
      // 用「包含」而不是「相等」：`display: grid` 与 `grid-template-columns`
      // 同时出现时会报出两条，而那是对的 —— 它们各自都是一件不该出现的事。
      expect([label, patterns.length > 0]).toEqual([label, true])
      expect([label, patterns.includes(expectedPattern)]).toEqual([label, true])
      // 上下文非空 —— 报错要指得出命中的那一段，不能只说「你违规了」。
      expect([label, (violations[0]?.context ?? '').length > 0]).toEqual([label, true])
    }
  })

  it('`normalizeCss` 抹掉大小写与空白 —— 这是三种写法都能命中的原因', () => {
    expect(normalizeCss('DISPLAY : \n  GRID')).toBe('display:grid')
    expect(normalizeCss('Column-Count: 2')).toBe('column-count:2')
  })

  it('**朴素的子串检查会漏掉 `display: flex`，扫描器不会**', () => {
    // 这条不是假想的：把 `RESUME_STYLES` 里 `.contacts li` 的 `display: inline`
    // 改成 `display: flex` 跑一遍测试，`ats.test.ts` 里那条
    // `expect(HTML).not.toContain(pattern)` 的循环**一条都没红** ——
    // 因为清单写的是 `display:flex`，而 CSS 里写的是 `display: flex`（有空格）。
    // 红的是本文件的六份产物扫描与 `package.test.ts` 的失败清单。
    // `normalizeCss` 就是为这一个空格存在的。
    const spaced = '<style>.half { display: flex; }</style>'
    expect(spaced).not.toContain('display:flex')
    expect(scanForbiddenLayout(spaced).map((item) => item.pattern)).toEqual(['display:flex'])
  })

  it('只扫样式面：正文里出现 `display:grid` 这些字样**不算违规**', () => {
    // 一份讲前端的项目描述里完全可能出现这个字面量，而那不是排版问题。
    // 若扫描器扫整个产物，用户会因为写了句真话而被判「排版不合格」。
    const prose = '<p>我们把列表从 float 改成了 display:grid，首屏快了 40%</p>'
    expect(scanForbiddenLayout(prose)).toEqual([])

    // 而同一个词出现在 `style` 属性里就是真的在排版了。
    const inline = '<p style="display:grid">x</p>'
    expect(scanForbiddenLayout(inline).map((item) => item.pattern)).toEqual(['display:grid'])
  })

  it('`styleSurface` 取的是 `<style>` 块与 `style` 属性，两种引号都取', () => {
    const html = `<style>a{b:c}</style><p style="d:e"></p><p style='f:g'></p>`
    expect(styleSurface(html)).toBe('a{b:c}\nd:e\nf:g')
  })

  it('标签类的违规扫整个文档 —— 转义保证了正文里的 `<` 一定是 `&lt;`', () => {
    // 所以「产物里出现 `<table`」只可能是一个真的标签，不会有假阳性。
    // 这一条与上一条合起来，解释了为什么两类禁止项的扫描范围故意不同。
    const escaped = '<p>&lt;table&gt; 是一个合法的 HTML 标签</p>'
    expect(scanForbiddenLayout(escaped)).toEqual([])
  })
})

describe('T4c · 三份真实产物都是单栏、自包含的', () => {
  it('校招样本与满档案的六份产物全部干净', () => {
    for (const pkg of [CLEAN, MAXIMAL]) {
      for (const view of [pkg.views.cn, pkg.views.en, pkg.views.bilingual]) {
        expect([view.name, scanForbiddenLayout(view.html)]).toEqual([view.name, []])
      }
    }
  })

  it('双语产物的两半是 body 的直接子元素，中间没有包裹层', () => {
    // 并排两栏需要一个 flex / grid 的**父容器**。所以「没有包裹层」这件事
    // 是结构上的第二道防线：即使样式表被改坏，也没有地方挂 `display:flex`。
    const html = CLEAN.views.bilingual.html
    const body = html.indexOf('<body>')
    const firstHalf = html.indexOf('<div class="half" lang="en">')
    const secondHalf = html.indexOf('<div class="half page-break" lang="zh-CN">')

    expect(body).toBeGreaterThanOrEqual(0)
    expect(html.match(/<div class="half/g)?.length).toBe(2)
    // 第一半紧跟在 `<body>` 之后，中间没有别的元素。
    expect(html.slice(body + '<body>'.length, firstHalf).trim()).toBe('')
    expect(firstHalf).toBeLessThan(secondHalf)
    // 两半之间没有 body 收尾 —— 那意味着它们不在同一份文档里。
    expect(html.slice(firstHalf, secondHalf)).not.toContain('</body>')
  })

  it('断页挂在后半上 —— 以断页属性结尾时部分渲染引擎会多吐一张空白页', () => {
    const html = CLEAN.views.bilingual.html
    // 不能断言 `indexOf('page-break') < indexOf('lang="zh-CN"')`：
    // 样式表里那一条 `.page-break` 规则在 `<head>` 里，所以那个不等式恒成立 ——
    // 一条恒真断言。判据要落在**半页的 class 属性**上。
    expect(html).toContain('class="half page-break" lang="zh-CN"')
    expect(html).not.toContain('class="half page-break" lang="en"')
    expect(html.trimEnd().endsWith('</html>')).toBe(true)
  })
})
