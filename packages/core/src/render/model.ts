/**
 * 文档模型 —— 排版无关的简历结构。
 *
 * **本模块与 `core/egress` 恰好相反，而那个相反是刻意的。**
 *
 * - `egress` 只允许 A 级离开设备；它读得到 B 级，但只丢弃、不观察。
 * - `render` **只允许 B 级进入产出物**；DESIGN 1.3 说得很清楚：
 *   「产出物中这部分内容由**确定性代码注入**（渲染是第 7 步，纯确定性），绝不经过模型」。
 *
 * 也就是说，姓名、手机号、邮箱这些字段在整个系统里只有两条路径：
 * 要么被模型层丢弃，要么在这一层被**逐字写进渲染产物**。中间没有第三条路。
 * 面试时如果被问「手机号到底走不走模型」，答案就在这两个模块的对照里。
 *
 * 文档模型刻意**不含任何排版信息**（没有字号、颜色、分栏）。理由不是分层好看：
 * 一旦模型里带上「两栏」这种结构，ATS 的可解析性就无法再从结构上保证 ——
 * 而 T4a 的全部验收标准都建立在「阅读顺序 == DOM 顺序」这个前提上。
 *
 * @see DESIGN 1.3 · 3.3 第 7 步 · 10.1
 */

import type { ArchiveV1 } from '../schema/index'

export type RenderTarget = 'resume_zh' | 'resume_en_campus'

export type RenderLang = 'zh' | 'en'

export interface ContactLine {
  readonly label: string
  readonly value: string
}

export interface DocumentEntry {
  /** 主标题行，如「某某科技有限公司 · 算法工程实习生」 */
  readonly heading: string
  /** 次要信息（时间、地点），按显示顺序 */
  readonly meta: readonly string[]
  /**
   * 关键词行：`推荐系统 · 协同过滤`。**已拼好的一条线**，不是数组。
   *
   * 为什么单独一个字段，而不是像第一版那样把它 `unshift` 进 `bullets`：
   * 它进 `bullets` 之后，任何「这一条要点能不能说出口」的下游都得把它当成
   * 一条正常要点 —— 自我介绍因此会念出「At Campus Marketplace Recommender,
   * I 推荐系统 · 协同过滤.」这种不是句子的话。**一个为 ATS 的子串匹配而拼的
   * 标签串，不是一条可以说出来的事实。** 分开存，下游才有得选。
   *
   * 空串表示这一条没有关键词行。渲染与页数估算都走 `entryLines()`，
   * 两处不会各自漂移。
   */
  readonly keywordLine: string
  readonly bullets: readonly string[]
}

/**
 * 这一条在页面上占的**全部**文本行，按渲染顺序。
 *
 * HTML 渲染与页数估算**必须**共用它：两处各拼一次的话，页数会与实际排版
 * 漂移，而漂移的症状是「估算说一页、导出来两页」—— 一条只在用户手里
 * 才出现的错。
 */
export function entryLines(entry: DocumentEntry): readonly string[] {
  return entry.keywordLine === '' ? entry.bullets : [entry.keywordLine, ...entry.bullets]
}

export interface DocumentSection {
  readonly id: string
  /** 节标题，如「教育背景」/「Education」 */
  readonly heading: string
  readonly entries: readonly DocumentEntry[]
}

export interface DocumentModel {
  readonly target: RenderTarget
  readonly lang: RenderLang
  /** B 级：确定性注入，不经过模型 */
  readonly name: string
  readonly label: string
  readonly summary: string
  readonly contacts: readonly ContactLine[]
  readonly sections: readonly DocumentSection[]
}

export interface BuildDocumentOptions {
  readonly target: RenderTarget
  /** 只渲染这些条目（来自匹配结果）。省略即全部渲染。 */
  readonly includedEntryIds?: readonly string[]
  /** 改写后的要点，按 entryId 覆盖原文。省略即用原始要点。 */
  readonly rewritten?: ReadonlyMap<string, readonly string[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 取 i18n 字段的值：优先目标语种，缺失时回退另一语种。
 *
 * 回退而不是留空，是因为**留空会产出一份静默残缺的简历** ——
 * 用户看到导出结果才发现「项目名不见了」，而那时他已经投出去三份了。
 * 回退至少让他看到中文项目名出现在英文简历里，一眼就能发现并去补。
 */
export function pickLang(value: unknown, lang: RenderLang): string {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return ''
  const preferred = value[lang]
  if (typeof preferred === 'string' && preferred.trim() !== '') return preferred
  const fallbackKey = lang === 'zh' ? 'en' : 'zh'
  const fallback = value[fallbackKey]
  return typeof fallback === 'string' ? fallback : ''
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** `2025-06` → `2025.06`；`2025-06` 与 `2025-09` → `2025.06 – 2025.09` */
function formatRange(start: unknown, end: unknown, lang: RenderLang): string {
  const from = str(start).replace('-', '.')
  const to = str(end).replace('-', '.')
  if (from === '' && to === '') return ''
  if (from !== '' && to === '') return lang === 'zh' ? `${from} 至今` : `${from} – Present`
  if (from === '') return to
  return `${from} – ${to}`
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function asStrings(value: unknown): readonly string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string')
}

function asRecords(value: unknown): readonly Record<string, unknown>[] {
  return asArray(value).filter(isRecord)
}

/**
 * 联系方式行的顺序是**固定的**，不随档案字段出现顺序变化。
 * 邮箱在手机前、手机在城市前 —— ATS 与人工阅读都习惯这个顺序，
 * 而「顺序随对象键序漂移」会让每次导出的产物都不同，快照断言也就没了意义。
 */
function buildContacts(contact: Record<string, unknown>, lang: RenderLang): readonly ContactLine[] {
  const labels: readonly [string, string, string][] = [
    ['email', '邮箱', 'Email'],
    ['phone', '电话', 'Phone'],
    ['wechat', '微信', 'WeChat'],
  ]
  const lines: ContactLine[] = []
  for (const [key, zhLabel, enLabel] of labels) {
    const value = str(contact[key])
    if (value !== '') lines.push({ label: lang === 'zh' ? zhLabel : enLabel, value })
  }
  const location = str(contact.location)
  if (location !== '') lines.push({ label: lang === 'zh' ? '城市' : 'Location', value: location })
  return lines
}

const SECTION_HEADINGS: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  work: ['工作经历', 'Experience'],
  projects: ['项目经历', 'Projects'],
  education: ['教育背景', 'Education'],
  skills: ['专业技能', 'Skills'],
  languages: ['语言能力', 'Languages'],
  awards: ['荣誉奖项', 'Awards'],
  certificates: ['证书', 'Certifications'],
})

/**
 * 节顺序。
 *
 * 两个 target 目前**共用同一套顺序**（教育前置），这不是偷懒 ——
 * 它们的目标场景相同（外企校招），招聘方第一眼看的是「哪所学校、什么时候毕业」。
 * 英文简历的默认顺序（经历在前）是给多年工作经验的人设计的，套到校招上是错的。
 *
 * 差异只在语言与用语规范（POLISH 层），不在顺序。将来若要加「有工作经验」的
 * target，这里才会分化 —— 而到那时候，这个表就是唯一要改的地方。
 */
const SECTION_ORDER: Readonly<Record<RenderTarget, readonly string[]>> = Object.freeze({
  resume_zh: ['education', 'work', 'projects', 'skills', 'languages', 'awards', 'certificates'],
  resume_en_campus: [
    'education',
    'work',
    'projects',
    'skills',
    'languages',
    'awards',
    'certificates',
  ],
})

function buildEntries(
  sectionId: string,
  raw: unknown,
  lang: RenderLang,
  options: BuildDocumentOptions,
): readonly DocumentEntry[] {
  const included = options.includedEntryIds
  const entries: DocumentEntry[] = []

  asRecords(raw).forEach((entry, index) => {
    const entryId = `${sectionId}.${index}`
    if (included !== undefined && !included.includes(entryId)) return

    const bullets = options.rewritten?.get(entryId) ?? asStrings(entry.highlights)

    if (sectionId === 'work') {
      const company = str(entry.company)
      const position = pickLang(entry.position ?? entry.title, lang)
      entries.push({
        heading: [company, position].filter((part) => part !== '').join(' · '),
        meta: [formatRange(entry.startDate, entry.endDate, lang), str(entry.location)].filter(
          (part) => part !== '',
        ),
        keywordLine: '',
        bullets,
      })
      return
    }

    if (sectionId === 'projects') {
      const keywords = asStrings(entry.keywords)
      entries.push({
        heading: pickLang(entry.name, lang),
        meta: [formatRange(entry.startDate, entry.endDate, lang)].filter((part) => part !== ''),
        // 技术关键词单独成行而不是拼进标题：ATS 的关键词匹配是子串级的，
        // 拼进标题会让「推荐系统」与「Campus Recommender」粘成一个长串。
        keywordLine: keywords.join(' · '),
        bullets,
      })
      return
    }

    if (sectionId === 'education') {
      const institution = str(entry.institution)
      const area = pickLang(entry.area, lang)
      const studyType = pickLang(entry.studyType, lang)
      const degree = [studyType, area].filter((part) => part !== '').join(' · ')
      entries.push({
        heading: [institution, degree].filter((part) => part !== '').join(' · '),
        meta: [formatRange(entry.startDate, entry.endDate, lang), str(entry.gpa)].filter(
          (part) => part !== '',
        ),
        keywordLine: '',
        bullets,
      })
      return
    }

    if (sectionId === 'skills') {
      // 技能节的 `keywords` 与项目节**不是一回事**：项目节的关键词是标签串
      // （拼成一条线，不可朗读），技能节的每个关键词是一个「会什么」，
      // 逐条成行、可以念（`My Languages include Python, SQL`）。所以这里
      // 放进 `bullets` 而不是 `keywordLine` —— 两者的下游处置不同。
      entries.push({
        heading: pickLang(entry.name, lang),
        meta: [],
        keywordLine: '',
        bullets: asStrings(entry.keywords),
      })
      return
    }

    if (sectionId === 'languages') {
      entries.push({
        heading: pickLang(entry.language, lang),
        meta: [str(entry.fluency), str(entry.score)].filter((part) => part !== ''),
        keywordLine: '',
        bullets: [],
      })
      return
    }

    if (sectionId === 'awards') {
      entries.push({
        heading: pickLang(entry.title, lang),
        meta: [str(entry.date).replace('-', '.'), str(entry.awarder)].filter(
          (part) => part !== '',
        ),
        keywordLine: '',
        bullets: [],
      })
      return
    }

    if (sectionId === 'certificates') {
      entries.push({
        heading: pickLang(entry.name, lang),
        meta: [str(entry.date).replace('-', '.'), str(entry.issuer), str(entry.score)].filter(
          (part) => part !== '',
        ),
        keywordLine: '',
        bullets: [],
      })
    }
  })

  return entries
}

/** 从档案构建文档模型。这是 B 级数据进入产出物的唯一入口。 */
export function buildDocumentModel(
  archive: ArchiveV1,
  options: BuildDocumentOptions,
): DocumentModel {
  const source = archive as unknown as Record<string, unknown>
  const basics = isRecord(source.basics) ? source.basics : {}
  const lang: RenderLang = options.target === 'resume_zh' ? 'zh' : 'en'

  const contact = isRecord(basics.contact) ? basics.contact : {}
  const location = isRecord(basics.location) ? basics.location : {}
  const contacts = buildContacts(
    { ...contact, location: str(location.city) },
    lang,
  )

  const sections: DocumentSection[] = []
  for (const sectionId of SECTION_ORDER[options.target]) {
    const headings = SECTION_HEADINGS[sectionId]
    if (headings === undefined) continue
    const entries = buildEntries(sectionId, source[sectionId], lang, options)
    if (entries.length === 0) continue
    sections.push({ id: sectionId, heading: lang === 'zh' ? headings[0] : headings[1], entries })
  }

  return {
    target: options.target,
    lang,
    name: pickLang(basics.name, lang),
    label: pickLang(basics.label, lang),
    summary: pickLang(basics.summary, lang),
    contacts,
    sections,
  }
}
