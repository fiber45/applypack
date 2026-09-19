/**
 * 交付 PDF 的模板 —— `DocumentModel` 的第二个渲染后端。
 *
 * ## 为什么是「第二个后端」，而不是把 HTML 转成 PDF
 *
 * `html.ts` 已经把同一个模型渲染成过一份 HTML。多写一份 PDF 模板看起来是
 * 重复劳动，但另两条路都走不通：
 *
 * | 方案 | 为什么不行 |
 * |---|---|
 * | `html2canvas` + jsPDF 之类 | 把页面**栅格化**成图片。文本层没了，ATS 抽出的是空白 —— 这份简历的核心卖点当场作废 |
 * | 打印 CSS（`window.print()`） | 模板只维护一份，但产物字节**不进 JS**：文件名控不了，页数量不了，回归在 CI 里不可见 |
 *
 * 于是接受「一份模型、两个后端」，并给这份重复**配一条断言**：
 * `delivery.test.ts` 把 pdfjs 抽出来的文本与 `PackageView.texts`（HTML 的
 * ATS 文本）逐字符比。**重复之所以安全，是因为它有检查**——
 * 没有那条断言，两份模板的漂移会以「PDF 里少了一段经历」的形式出现在用户手上。
 *
 * ## 与 HTML 的两处刻意不同
 *
 * 1. **联系方式一行一项**，而 HTML 用 `display: inline` 排成一行。
 *    看起来是退步，其实是把已有的不一致摆正：HTML 的 ATS 文本本来就是
 *    一行一项（`extractLines` 按块标签断行，看不见 CSS），所以 PDF 这样排
 *    才是**与声明一致**的那一边。而且一行一项是 ATS 最稳的排法。
 * 2. **要点带 `•` 标记**，HTML 靠 `list-style` 让浏览器画。
 *    这个字是真实文本层里多出来的字符，所以它被登记进
 *    `DELIVERY_DECORATIONS`，并有一条断言保证「多余字符不超出声明」。
 *
 * ## 版式数字一个都不在这里写
 *
 * 字号、行距、页边距全部来自 `CAMPUS_LAYOUT`。写在这里的话，
 * 「改了字号」会变成两处改动，而漏改一处的症状是 PDF 与页数估算不再对应。
 *
 * @see TASKS.md T4a · DESIGN 10.1
 */

import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import {
  CAMPUS_LAYOUT,
  MM_PER_PT,
  entryLines,
  type DocumentEntry,
  type DocumentModel,
  type PackageView,
} from '../../../../core/src/render/index'
import { DELIVERY_FONT_FAMILY } from './fonts'

/** mm → pt。`layout.ts` 给的是 mm 每 pt，这里要反过来。 */
function pt(mm: number): number {
  return mm / MM_PER_PT
}

const L = CAMPUS_LAYOUT
const B = L.blocks

const styles = StyleSheet.create({
  page: {
    size: 'A4',
    padding: pt(L.page.marginMm),
    fontFamily: DELIVERY_FONT_FAMILY,
    fontSize: L.bodyFontPt,
    lineHeight: L.lineHeight,
    color: '#000000',
  },
  name: {
    fontSize: B.name.fontPt,
    fontWeight: 600,
    marginBottom: B.name.marginBottomPt,
  },
  label: {
    fontSize: B.label.fontPt,
    marginBottom: B.label.marginBottomPt,
  },
  contact: { fontSize: B.contacts.fontPt },
  /** `.contacts` 的 `margin-bottom`，落在最后一个联系方式上。 */
  contactsBlock: { marginBottom: B.contacts.marginBottomPt },
  summary: {
    marginTop: B.summary.marginTopPt,
    marginBottom: B.summary.marginBottomPt,
  },
  sectionHeadingBlock: {
    marginTop: B.sectionHeading.marginTopPt,
    marginBottom: B.sectionHeading.marginBottomPt,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    borderBottomStyle: 'solid',
    // `RESUME_STYLES` 里 `h2 { padding-bottom: 2pt }`：横线与文字之间的那条缝。
    paddingBottom: 2,
  },
  sectionHeading: { fontSize: B.sectionHeading.fontPt },
  entry: { marginBottom: B.entryGap.marginBottomPt },
  entryHeading: { fontSize: B.entryHeading.fontPt, fontWeight: 600 },
  entryMeta: {
    fontSize: B.entryMeta.fontPt,
    marginTop: B.entryMeta.marginTopPt,
  },
  /** `<ul>` 自身的上外边距。 */
  list: { marginTop: B.listGap.marginTopPt },
  bulletRow: {
    flexDirection: 'row',
    paddingLeft: B.bullet.indentPt,
    marginTop: B.bullet.marginTopPt,
    marginBottom: B.bullet.marginBottomPt,
  },
  /** 固定宽度让正文在标记右侧对齐 —— 换行的续行也挂在同一列上。 */
  bulletMarker: { width: 12 },
  bulletText: { flexGrow: 1, flexShrink: 1 },
})

/**
 * 联系方式的「标签 — 值」分隔符。
 *
 * **这是 `html.ts` 里 `contactSeparator` 的复制品**，复制是有意的：
 * 让 core 为一个渲染细节多开一个导出，等于把「怎么排」漏进 core 的公开面。
 * 复制之所以安全，同样是因为 `delivery.test.ts` 会逐字符比两个后端的文本 ——
 * 分隔符在这里写错，那条断言立刻红。
 */
function contactSeparator(lang: DocumentModel['lang']): string {
  return lang === 'zh' ? '：' : ': '
}

function Entry({ entry }: { readonly entry: DocumentEntry }): React.JSX.Element {
  const lines = entryLines(entry)
  return (
    <View style={styles.entry}>
      <Text style={styles.entryHeading}>{entry.heading}</Text>
      {entry.meta.length > 0 ? (
        <Text style={styles.entryMeta}>{entry.meta.join(' · ')}</Text>
      ) : null}
      {lines.length > 0 ? (
        <View style={styles.list}>
          {lines.map((line, index) => (
            // 下标当 key：条目内要点的**顺序即身份**，而内容会因改写而变，
            // 用内容当 key 会让 React 在改写后认错节点。
            <View key={index} style={styles.bulletRow}>
              <Text style={styles.bulletMarker}>●</Text>
              <Text style={styles.bulletText}>{line}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function Body({ model }: { readonly model: DocumentModel }): React.JSX.Element {
  const separator = contactSeparator(model.lang)
  return (
    <>
      <Text style={styles.name}>{model.name}</Text>
      {model.label !== '' ? <Text style={styles.label}>{model.label}</Text> : null}
      {model.contacts.length > 0 ? (
        <View style={styles.contactsBlock}>
          {model.contacts.map((line, index) => (
            <Text key={index} style={styles.contact}>
              {`${line.label}${separator}${line.value}`}
            </Text>
          ))}
        </View>
      ) : null}
      {model.summary !== '' ? (
        <Text style={styles.summary}>{model.summary}</Text>
      ) : null}
      {model.sections.map((section) => (
        <View key={section.id}>
          <View style={styles.sectionHeadingBlock}>
            <Text style={styles.sectionHeading}>{section.heading}</Text>
          </View>
          {section.entries.map((entry, index) => (
            <Entry key={index} entry={entry} />
          ))}
        </View>
      ))}
    </>
  )
}

/**
 * 一份文档 = 一个或多个页面。
 *
 * 双语版用**两个 `<Page>`**，而不是一个页面里塞断页属性：
 * 「EN 在前、CN 在后、各自从新页开始」（DESIGN 10.1）在 PDF 里就是两页，
 * 让它在结构上成立比让它靠排版属性生效更可靠 —— 后者会被内容长度影响，
 * 而前者不会。
 *
 * `hyphenationCallback` 在 `fonts.ts` 的登记处关闭（见那里的注释）。
 */
export function DeliveryDocument({
  view,
}: {
  readonly view: PackageView
}): React.JSX.Element {
  return (
    <Document>
      {view.models.map((model, index) => (
        <Page key={index} style={styles.page}>
          <Body model={model} />
        </Page>
      ))}
    </Document>
  )
}
