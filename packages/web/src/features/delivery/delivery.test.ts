// @vitest-environment node
/**
 * T4a 那个空勾的执行者：**生成的 PDF 里，文本层到底是什么。**
 *
 * ## 为什么这个文件必须是 node 环境
 *
 * 它验的不是「DOM 里渲染出了什么」，是**字节**。字节要在 Node 里生成
 * （`renderToBuffer`）、也要在 Node 里读回来（pdfjs），所以这里显式覆盖
 * 包级的 jsdom 设置。这不是绕过约束：`packages/web` 是允许有 DOM 的那一层，
 * 而这两个用例本来就不碰 DOM。反过来，把 PDF 生成塞进 core 才是破坏约束。
 *
 * ## 判据只有一条，其余都是它的护栏
 *
 * 主判据：**pdfjs 从 PDF 抽出的文本 == `PackageView.texts`**（HTML 的 ATS 文本），
 * 忽略全部空白、允许已声明的装饰。理由与口径写在 `verify.ts` 的文件头。
 *
 * 围绕它的一圈护栏，每一条都在回答「主判据是不是在空转」：
 *
 * | 护栏 | 防的是 |
 * |---|---|
 * | 归一化后长度 > 300 | **两个空串相等** —— 最省事的通过方式就是把什么都没渲染出来 |
 * | 装饰的出现次数 == 要点行数 | 声明集变成废纸：写了 `•` 允许，模板却早就不画了 |
 * | 未声明的多余字符为空 | 用一个宽松的声明集把「模板多渲染了东西」吃掉 |
 * | PDF 头 `%PDF-` 与字节数下限 | 传进来的是空文件却一路比到最后 |
 * | 装饰字符不出现在 HTML 文本里 | 删装饰会同时删掉真实内容，判据不再可靠 |
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  buildDeliveryPackage,
  entryLines,
  type DeliveryPackage,
  type PackageView,
} from '../../../../core/src/render/index'
import { campusArchiveV1, campusRewritten } from '../../../../core/src/render/__fixtures__/campus-archive'
import { maximalArchiveV1 } from '../../../../core/src/schema/__fixtures__/maximal-archive'
import { nodeFontSources, registerDeliveryFonts } from './fonts'
import { extractPdfText, type PdfTextLayer } from './pdf-text'
import { renderViewToBytes } from './render-node'
import {
  DELIVERY_DECORATIONS,
  compareTextLayers,
  stripWhitespace,
  type TextLayerComparison,
} from './verify'

/**
 * 字体目录的绝对路径。
 *
 * `new URL('.', import.meta.url)` 给的是 `file:///C:/...` 形式，`.pathname`
 * 在 Windows 上会多一个前导斜杠（`/C:/...`），而 Node 的 `fs` 会把
 * `/C:/x` 解析成 `C:\C:\x`。只在「第二个字符是盘符冒号」时削掉那一个斜杠，
 * 于是 POSIX 路径原样通过。**不能用 `process.cwd()` 代替**：cwd 取决于
 * 谁在跑测试（turbo / pnpm / vitest 直接调），而这是一条只在 CI 上才暴露的差异。
 */
const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(
  /^\/(?=[A-Za-z]:)/,
  '',
)
const FONT_DIR = `${HERE}../../../public/fonts`

registerDeliveryFonts(nodeFontSources(FONT_DIR))

/** 这一版里所有要点的行数（含项目的关键词行）—— 也就是 `●` 应该出现的次数。 */
function bulletLineCount(view: PackageView): number {
  let count = 0
  for (const model of view.models) {
    for (const section of model.sections) {
      for (const entry of section.entries) count += entryLines(entry).length
    }
  }
  return count
}

interface RenderedView {
  readonly view: PackageView
  readonly bytes: Uint8Array
  readonly layer: PdfTextLayer
  readonly comparison: TextLayerComparison
}

async function render(pkg: DeliveryPackage, view: PackageView): Promise<RenderedView> {
  void pkg
  const bytes = await renderViewToBytes(view)
  const layer = await extractPdfText(bytes)
  return { view, bytes, layer, comparison: compareTextLayers(view.texts.join('\n'), layer.text) }
}

const CAMPUS = buildDeliveryPackage(campusArchiveV1, { rewritten: campusRewritten })
const MAXIMAL = buildDeliveryPackage(maximalArchiveV1)

const rendered = new Map<PackageView, RenderedView>()

beforeAll(async () => {
  for (const view of [
    CAMPUS.views.cn,
    CAMPUS.views.en,
    CAMPUS.views.bilingual,
    MAXIMAL.views.cn,
    MAXIMAL.views.en,
    MAXIMAL.views.bilingual,
  ]) {
    rendered.set(view, await render(CAMPUS, view))
  }
}, 180_000)

const ALL_VIEWS: readonly PackageView[] = [
  CAMPUS.views.cn,
  CAMPUS.views.en,
  CAMPUS.views.bilingual,
  MAXIMAL.views.cn,
  MAXIMAL.views.en,
  MAXIMAL.views.bilingual,
]

function renderedOf(view: PackageView): RenderedView {
  const entry = rendered.get(view)
  if (entry === undefined) throw new Error(`没有渲染过 ${view.name}`)
  return entry
}

describe('PDF 文本层 == HTML 的 ATS 文本（T4a 的反向抽取）', () => {
  it.each(ALL_VIEWS.map((view) => [view.name, view] as const))(
    '%s：逐字符一致',
    (_name, view) => {
      const { comparison, bytes } = renderedOf(view)

      // 先确认产物是真 PDF，而不是一条走到最后才发现是空文件的链路。
      expect(bytes.length).toBeGreaterThan(1_000)
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')

      expect(comparison.pass, comparison.detail).toBe(true)
    },
  )

  it.each(ALL_VIEWS.map((view) => [view.name, view] as const))(
    '%s：不比两个空串 —— 归一化后确实有内容',
    (_name, view) => {
      const { comparison } = renderedOf(view)
      // 这是整组判据里最重要的护栏。少了它，「什么都没渲染出来」能满分通过：
      // 空串与空串逐字符相等，而且快得不像有问题。
      expect(comparison.normalizedHtml.length).toBeGreaterThan(300)
      expect(comparison.normalizedPdf.length).toBeGreaterThan(300)
    },
  )

  it('声明的装饰确实被渲染了 —— 声明集不是废纸', () => {
    // 校招样本每个条目都有要点，所以 `●` 的出现次数必须**精确等于**要点行数。
    // 若模板哪天不画标记了，这里会红；若不画却还留着声明，主判据会因为
    // 「允许了不存在的东西」而变得宽松 —— 那条路在这里被堵住。
    // （标记字符必须是 `●` 而不是 `•`，字形共享问题见 verify.ts 的声明集注释。）
    for (const view of [CAMPUS.views.cn, CAMPUS.views.en]) {
      const { comparison } = renderedOf(view)
      const expected = bulletLineCount(view)
      expect(expected).toBeGreaterThan(0)
      expect(comparison.decorationCounts.get('●')).toBe(expected)
    }
  })

  it('装饰字符不出现在 HTML 文本里 —— 否则「删装饰」会删掉真实内容', () => {
    for (const view of ALL_VIEWS) {
      const { comparison } = renderedOf(view)
      expect(comparison.conflicts, `${view.name} 的装饰集与内容冲突`).toEqual([])
    }
    // 声明集本身也要非空，否则这条断言在下一次改动后就变成空转。
    expect(DELIVERY_DECORATIONS.length).toBeGreaterThan(0)
  })

  it('HTML 那份文本里没有装饰字符 —— 交叉确认上一格不是巧合', () => {
    for (const view of ALL_VIEWS) {
      const html = stripWhitespace(view.texts.join('\n'))
      for (const decoration of DELIVERY_DECORATIONS) {
        expect(html.includes(decoration), `${view.name} 的内容里有「${decoration}」`).toBe(false)
      }
    }
  })
})

describe('页数：估算第一次被实测对照（T4b 那笔账）', () => {
  it('校招样本：中版 1 页、英版 1 页、双语 2 页', () => {
    expect(renderedOf(CAMPUS.views.cn).layer.pageCount).toBe(1)
    expect(renderedOf(CAMPUS.views.en).layer.pageCount).toBe(1)
    // 双语是「EN 半页 + CN 半页」，各自从新页开始 —— 所以在 PDF 里就是两页。
    // 这条比估算值强：它不依赖任何版式近似。
    expect(renderedOf(CAMPUS.views.bilingual).layer.pageCount).toBe(2)
  })

  it('双语实测页数 == 中英两个单独版本的页数之和', () => {
    // `paginate.ts` 里那句「拼页时页数估算从近似变成精确」现在可以被
    // 实测验证，而不是只靠同一套算式的自洽。
    expect(renderedOf(CAMPUS.views.bilingual).layer.pageCount).toBe(
      renderedOf(CAMPUS.views.cn).layer.pageCount +
        renderedOf(CAMPUS.views.en).layer.pageCount,
    )
  })

  it.each(ALL_VIEWS.map((view) => [view.name, view] as const))(
    '%s：估算只可能高报，不会低报',
    (_name, view) => {
      const { layer } = renderedOf(view)
      // T4b 里「误差方向是被选的」那句话，当时只能靠读代码确认。
      // 现在它是一条断言：估算 ≥ 实测。若哪天有人把字形宽度调窄到乐观，
      // 这里会红 —— 而 N 版之前，那种改动是完全静默的。
      expect(
        view.pages.pages,
        `${view.name} 估算 ${view.pages.pages} 页、实测 ${layer.pageCount} 页`,
      ).toBeGreaterThanOrEqual(layer.pageCount)
    },
  )
})

describe('三版之间的文本互不相同（防止某两版其实是同一份）', () => {
  it('中版与英版的 PDF 文本不一样', () => {
    const cn = renderedOf(CAMPUS.views.cn).comparison.normalizedPdf
    const en = renderedOf(CAMPUS.views.en).comparison.normalizedPdf
    expect(cn).not.toBe(en)
  })

  it('双语版的文本 = 英版 + 中版（顺序拼页，EN 在前）', () => {
    const cn = renderedOf(CAMPUS.views.cn).comparison.normalizedPdf
    const en = renderedOf(CAMPUS.views.en).comparison.normalizedPdf
    const bilingual = renderedOf(CAMPUS.views.bilingual).comparison.normalizedPdf
    // 与 `package.ts` 的 `bilingual_not_sequential` 是同一条判据，
    // 区别只是这次的输入是**成品**而不是模型。
    expect(bilingual).toBe(en + cn)
  })
})
