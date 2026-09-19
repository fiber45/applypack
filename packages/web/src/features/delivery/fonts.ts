/**
 * 交付 PDF 的字体登记 —— **两种运行环境唯一的差别就在这里**。
 *
 * ## 为什么字体必须内嵌，而不是「让阅读器自己找」
 *
 * PDF 只记录「用某某字体、某某字号画这几个字」，字体本身要由阅读器提供。
 * 不内嵌的话，中文简历在没装中文字体的阅读器上会渲染成方框，而
 * **ATS 拿到的文本层也会一起烂掉** —— 那不是排版难看，是这份简历废了。
 * 所以字体必须随文档走，这一条没有可商量的余地。
 *
 * ## 为什么路径是注入的，而不是模块里写死
 *
 * 同一份模板要在两个地方跑：
 *
 * | 环境 | `src` 的形式 | 谁去读 |
 * |---|---|---|
 * | 浏览器（用户点「导出」） | `/fonts/NotoSansSC-Regular.ttf` 这样的 URL | `fetch` |
 * | Node（`pnpm test` 里的反向抽取） | 磁盘上的绝对路径 | `fontkit.open()` → `fs` |
 *
 * react-pdf 内部就是按这两种形态分流的（`@react-pdf/font` 的 `_load()`），
 * 所以这里只需要**把正确形态的字符串给对**。写死任何一种都会让另一半跑不起来，
 * 而症状是「测试通过但导出是方框」或者反过来 —— 两种都不会在 CI 里红，
 * 除非两条路各有一条断言。见 `delivery.test.ts`。
 *
 * 路径由调用方给，而不是这里猜 `import.meta.url`：`import.meta.url` 在
 * Vite 打包后指向 chunk 的位置，在测试里指向源文件的位置，两者不是一回事。
 *
 * ## 为什么是两个字重
 *
 * `RESUME_STYLES` 里 `h1` 与 `.entry h3` 是 `font-weight: 600`，正文是 400。
 * PDF **不能合成伪粗体**（那是渲染器行为，不是 PDF 能力），所以两个字重
 * 都得有真实字体文件。代价是仓库外多出 21 MB 的字体资产 ——
 * 这笔账记在 `TASKS.md` 的 T4a 里，见 `scripts/fetch-fonts.mjs` 的文件头。
 */

import { Font } from '@react-pdf/renderer'

/** 模板里 `fontFamily` 引用的名字。改这里等于改所有模板。 */
export const DELIVERY_FONT_FAMILY = 'NotoSansSC'

/** 字体文件名。与 `scripts/fetch-fonts.mjs` 里那张表必须一致。 */
export const DELIVERY_FONT_FILES = Object.freeze({
  regular: 'NotoSansSC-Regular.ttf',
  semibold: 'NotoSansSC-SemiBold.ttf',
})

/** 字体在 `public/` 下的目录名。 */
export const DELIVERY_FONT_DIR = 'fonts'

export interface DeliveryFontSources {
  /** 正文字重（400）的 src。 */
  readonly regular: string
  /** 标题字重（600）的 src。 */
  readonly semibold: string
}

/**
 * 已经登记过的 src 组合。
 *
 * 不是性能优化，是为了**幂等**：`Font.register` 是全局注册表，同一族名反复
 * 登记会不断追加数组项，而 react-pdf 按 `fontWeight` 查找时取的是**第一个**
 * 匹配项 —— 第二次登记如果换了字体文件，表现是「改了代码但产物没变」。
 * 记下 key，换文件时才重新登记。
 */
let registeredKey: string | null = null

/** 登记交付字体。渲染任何一份 PDF 之前必须先调用一次。 */
export function registerDeliveryFonts(sources: DeliveryFontSources): void {
  const key = `${sources.regular}\u0000${sources.semibold}`
  if (key === registeredKey) return

  Font.register({
    family: DELIVERY_FONT_FAMILY,
    fonts: [
      { src: sources.regular, fontWeight: 400 },
      { src: sources.semibold, fontWeight: 600 },
    ],
  })

  /**
   * 返回单元素数组 = **关闭连字符断行**（这版 @react-pdf/renderer 没有
   * `<Document hyphenationCallback>` prop，只能在全局登记表上设）。
   * 不是审美选择：自动连字符会把 `-` 插进文本层，而那个 `-` 在 HTML 的
   * ATS 文本里不存在，于是它要么被算成「多余字符」报警，要么被加进装饰集，
   * 从而把「这里本来是连字符」和「这里是断行」混为一谈。
   */
  Font.registerHyphenationCallback((word: string) => [word])

  registeredKey = key
}

/**
 * 浏览器用的 src：`public/fonts/` 下的 URL。
 *
 * `baseUrl` 必须显式传入（在应用里是 `import.meta.env.BASE_URL`）。
 * 不在这里读 `import.meta.env` 的理由与不读 `import.meta.url` 相同：
 * 本模块同时被 Node 测试加载，而 Node 里没有 `import.meta.env` ——
 * 那会让「测试跑不起来」和「浏览器跑不起来」变成一个症状，分不清是哪一个。
 */
export function browserFontSources(baseUrl: string): DeliveryFontSources {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  return {
    regular: `${base}/${DELIVERY_FONT_DIR}/${DELIVERY_FONT_FILES.regular}`,
    semibold: `${base}/${DELIVERY_FONT_DIR}/${DELIVERY_FONT_FILES.semibold}`,
  }
}

/** Node（测试 / 构建脚本）用的 src：`public/fonts/` 目录的绝对路径。 */
export function nodeFontSources(directory: string): DeliveryFontSources {
  const base = directory.endsWith('/') ? directory.slice(0, -1) : directory
  return {
    regular: `${base}/${DELIVERY_FONT_FILES.regular}`,
    semibold: `${base}/${DELIVERY_FONT_FILES.semibold}`,
  }
}

/** 仅供测试与调试：当前登记状态（`null` 表示还没登记过）。 */
export function registeredFontKey(): string | null {
  return registeredKey
}
