/**
 * 自我介绍的**事实源** —— T4d 第一条勾（「三档共用同一事实源」）的实现。
 *
 * ## 「共用同一事实源」在类型上是什么意思
 *
 * DESIGN 10.1 的原话是：
 *
 * > 自我介绍不是另写一份文档，是同一份档案的另一个视图。
 * > 否则用户改完简历还要回头逐句改自我介绍，迟早对不上。
 *
 * 「迟早对不上」有两种防法，一种靠纪律，一种靠结构：
 *
 * | 做法 | 结果 |
 * |---|---|
 * | 自我介绍有自己的提示词、自己读档案字段 | 靠纪律。改完简历忘记改自我介绍时**没有任何症状** |
 * | 自我介绍的事实从**简历的文档模型**里取 | 结构上不可能不一致：两个视图读的是同一个 `DocumentModel` |
 *
 * 这里是第二种。本模块的输入不是 `ArchiveV1`，是**已经建好的两个 `DocumentModel`**
 * （`resume_zh` 与 `resume_en_campus`）。取值、i18n 回退、节顺序、改写后的要点 ——
 * 全部在 `buildDocumentModel` 里发生过一次，这里只是把它们重新组织成句。
 * 所以「同一份事实源」不是一句承诺，是一条类型约束：**本模块拿不到档案，
 * 也就没有办法读到模型之外的字段。**
 *
 * ## 为什么一条事实同时带着两种语言的句子
 *
 * `IntroFact` 的 `zh` 与 `en` 是**同一个 `id` 下的两个渲染结果**。
 * 这个形状是「中英两版数字集合必须相等」（DESIGN 10.2）的结构实现：
 *
 * - 选择事实时，两种语言面对的是同一个列表、同一批 `id`；
 * - 带数字的事实**同进同出**（见 `compose.ts`），所以它的数字两边都有；
 * - 于是「中英数字相等」在结构上成立，而那条校验退化成一条**回归绊线** ——
 *   它抓的是**模板漂移**：某次改动让英文模板丢掉了 `2021.09`，而中文模板还在写。
 *   那种错误没有症状（两边都读得通），只能靠比对抓。
 *
 * 一个直接的好处：模板漂移的失败信息能落到**具体哪一条事实**上 ——
 * 每条事实的两种渲染都在手边。
 *
 * ## 为什么按「要点」而不是按「整段经历」切
 *
 * 档位差得很大（60 秒 → 3 分钟，5 倍）。按段切的话，一段经历就是一个不可分的
 * 单位，「还剩 40 字但下一段要 60 字」这种常见情形只能整段丢弃，于是合成器
 * 永远填不满预算。按要点切，粒度与预算匹配：60 秒档取前几条、3 分钟档取全部，
 * **同一份事实源、同一次排序、同一个 ids 列表**。
 *
 * ## 两处刻意的取舍
 *
 * **① 档位越级时「跳过」而不是「停止」。** 事实按 `rank` 排序，合成器从头扫描。
 * 某一条装不下时，「停止」保证不越级，但一条过长的开头会让整篇只剩第一段 ——
 * 那看上去像「档案里没东西」，而实际是有的。所以这里选跳过，并且**把跳过报出来**
 * （`IntroView.skipped`）。不能接受的是「悄悄越级」，「越级且说明原因」可以接受。
 *
 * **② 公司名与学校名在英文版里仍是中文。** 档案里 `company` / `institution`
 * 是单个字符串（不是 `{zh, en}`），而 `position` / `area` / `studyType` 是 i18n 的。
 * 所以英文自述会读成 `At 某某科技有限公司 as a Algorithm Engineer Intern`。
 * 那不是本模块能修的（要修得先改 schema 把机构名也变成 i18n），
 * 写在这里而不是绕过去。
 */

import type { DocumentEntry, DocumentModel, RenderLang } from '../render/model'
import { extractNumbers } from '../verify/numbers'

export type IntroFactKind =
  /** 姓名与一句话定位。**永远在第一位，且必收。** */
  | 'identity'
  /** 档案里的一句话自述。 */
  | 'summary'
  | 'education'
  | 'experience'
  | 'project'
  | 'skill'

export interface IntroFact {
  /** `work.0.1` 这种：节 id + 条目下标 + 槽位（要点下标或 `heading`）。**两种语言共用这一个 id。** */
  readonly id: string
  readonly kind: IntroFactKind
  /** 优先级：小的先收。由 `kind` 与文档顺序决定，不从档案顺序推导。 */
  readonly rank: number
  readonly zh: string
  readonly en: string
  /** 两种渲染里出现的数字**并集**。空数组表示这条事实不带数字。 */
  readonly numbers: readonly string[]
  /**
   * 英文侧**直接复用了中文原文** —— 这条事实没有独立的英文表达。
   *
   * 这不是把 `en === zh` 当启发式用，而是在**做出回退决定的地方**记一笔：
   * 要点是档案里唯一的非 i18n 文本（`highlights` 是一个数组两语共用），
   * 只有跑过英文改写（T3.1）才会有独立的英文版。所以「英文要点与中文要点
   * 逐字相同」在本系统里恰好等价于「这段英文还没被写出来」。
   *
   * 为什么要单独记：一条自述「太短」时，可动的有两件事 —— 往档案里补事实，
   * 或者把英文侧写出来。**这两件事的代价差一个量级**，而只报「太短」
   * 会让用户去做更贵的那件（补事实），且补了也还是中文。
   */
  readonly zhFallback: boolean
}

export interface IntroModels {
  readonly zh: DocumentModel
  readonly en: DocumentModel
}

/**
 * 事实按段位排序，而不是按档案顺序。
 *
 * `identity` → `summary` → `education` → `experience` → `project` → `skill`：
 * 60 秒里最重要的是「我是谁、我怎么定位自己、我在哪读书、我做过什么」，
 * 技能可以最后补。**这是产品判断，不是推导出来的** —— 改这里的顺序会让
 * 所有档位的开头都变，所以它单独成表，且有一条断言记录当前顺序。
 */
const KIND_RANK: Readonly<Record<IntroFactKind, number>> = Object.freeze({
  identity: 0,
  summary: 100,
  education: 200,
  experience: 300,
  project: 400,
  skill: 500,
})

/**
 * 收进自我介绍的节。四个 `*Drafts` 函数实现的正是这张白名单 ——
 * 写成白名单而不是黑名单，是为了让「将来 schema 加新节」的默认行为是**不收**：
 * 要不要念出来必须有人明确决定。`intro.test.ts` 里有一条断言用「语言能力」
 * 这个未列入的节验证白名单是真的在起作用。
 */
export const INCLUDED_SECTIONS: readonly string[] = Object.freeze([
  'education',
  'work',
  'projects',
  'skills',
])

/**
 * `buildDocumentModel` 用这个串拼主标题（`公司 · 职位`）。这里按同一个串拆开。
 *
 * 这是一个**跨模块的隐式契约**：`model.ts` 改了分隔符而这里没改，结果是
 * 「职位名变成整条标题」—— 读得通、不报错、内容错。所以有一条断言直接盯着它。
 */
const HEADING_SEPARATOR = ' · '

const PERIOD: Readonly<Record<RenderLang, string>> = Object.freeze({ zh: '。', en: '.' })

function ensurePeriod(text: string, lang: RenderLang): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  return /[.?!。！？]$/u.test(trimmed) ? trimmed : `${trimmed}${PERIOD[lang]}`
}

/**
 * 把英文句子的首字母小写，好嵌进 `I ___` 这样的模板。
 *
 * 两个例外都是必须的：单词只有一个字母（`I`）时保持原样；首词全大写
 * （`ML` / `RAG`）时也保持原样 —— 否则会得到 `mL pipeline` 这种句子。
 */
function lowerFirst(text: string): string {
  const trimmed = text.trim()
  const [first = '', ...rest] = trimmed.split(' ')
  if (first.length <= 1 || first === first.toUpperCase()) return trimmed
  return [first.charAt(0).toLowerCase() + first.slice(1), ...rest].join(' ')
}

function splitHeading(heading: string): readonly string[] {
  return heading
    .split(HEADING_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/** 一段并列成分（学位、方向）按语言接起来。 */
function listOf(parts: readonly string[], lang: RenderLang): string {
  return parts.filter((part) => part !== '').join(lang === 'zh' ? '、' : ' · ')
}

function numbersOf(zh: string, en: string): readonly string[] {
  const set = new Set<string>()
  for (const text of [zh, en]) for (const number of extractNumbers(text)) set.add(number)
  return [...set]
}

interface Draft {
  readonly id: string
  readonly kind: IntroFactKind
  readonly zh: string
  readonly en: string
  /** 省略即 `false`（英文侧是独立写出来的）。见 `IntroFact.zhFallback`。 */
  readonly zhFallback?: boolean
}

function entriesOf(model: DocumentModel, sectionId: string): readonly DocumentEntry[] {
  return model.sections.find((section) => section.id === sectionId)?.entries ?? []
}

/**
 * 成对的条目视图。`head` 是主标题的第一段（机构 / 公司 / 项目名），
 * `tail` 是其余部分（职位、学位 · 方向）。
 *
 * 英文侧缺失时回退中文侧：宁可让英文自述里出现一句中文，也不能让这条事实
 * 消失 —— 消失意味着它的数字只在中文侧存在，那时「中英数字相等」会红，
 * 而真实原因是节结构不一致（一个更值得报出来的问题，见 `check.ts` 的
 * `intro_cross_language_mismatch`）。
 */
interface PairedEntry {
  readonly zhHead: string
  readonly zhDates: string
  readonly zh: DocumentEntry
  readonly en: DocumentEntry | undefined
}

function pairedEntries(models: IntroModels, sectionId: string): readonly PairedEntry[] {
  const en = entriesOf(models.en, sectionId)
  return entriesOf(models.zh, sectionId).map((zh, index) => ({
    zhHead: splitHeading(zh.heading)[0] ?? '',
    zhDates: zh.meta[0] ?? '',
    zh,
    en: en[index],
  }))
}

function educationDrafts(models: IntroModels): readonly Draft[] {
  const drafts: Draft[] = []

  pairedEntries(models, 'education').forEach((pair, index) => {
    const enParts = pair.en === undefined ? [] : splitHeading(pair.en.heading)
    const zhDegree = listOf(splitHeading(pair.zh.heading).slice(1), 'zh')
    const enDegree = listOf(enParts.slice(1), 'en')
    const enDates = pair.en?.meta[0] ?? pair.zhDates

    drafts.push({
      // 条目级事实占 `heading` 这个槽位。槽位名是字符串，与要点下标（数字）
      // 天然不冲突 —— 「学历」与「工作」两节的 id 命名因此不需要各写一套，
      // 也不会出现「第 0 条要点把条目级事实盖掉」这种重名。
      // `intro.test.ts` 有一条断言直接盯着「所有 fact id 互不相同」，
      // 因为重名的症状是**静默丢一条事实**，不是报错。
      id: `education.${index}.heading`,
      kind: 'education',
      zh: ensurePeriod(
        `我在${pair.zhHead}${zhDegree === '' ? '' : `读${zhDegree}`}，时间是${pair.zhDates}`,
        'zh',
      ),
      // 日期在两种模板里都必须出现 —— 它是这一条事实唯一的数字来源。
      en: ensurePeriod(
        `I studied ${enDegree === '' ? '' : `${enDegree} `}at ${enParts[0] ?? pair.zhHead}, ${enDates}`,
        'en',
      ),
    })

    drafts.push(...bulletDrafts('education', index, pair, 'education', true))
  })

  return drafts
}

function experienceDrafts(models: IntroModels): readonly Draft[] {
  return pairedEntries(models, 'work').flatMap((pair, index) =>
    bulletDrafts('work', index, pair, 'experience', false),
  )
}

function projectDrafts(models: IntroModels): readonly Draft[] {
  return pairedEntries(models, 'projects').flatMap((pair, index) =>
    bulletDrafts('projects', index, pair, 'project', false),
  )
}

/**
 * 经历 / 项目 / 学业共用的切法：第一条要点带「在哪儿、做什么」的引导语，
 * 后面的要点直接续上。
 *
 * 引导语只加在第一条上而不是每条都加，是因为念的时候上下文已经建立了 ——
 * 每条都重复「在某某公司做某某实习生期间」既占预算又不像人话。
 *
 * `entryFactExists` 说的是「这个节的条目级事实是不是已经有别的地方在产」：
 * 学业有（`education.N.heading`），工作与项目没有 —— 它们的条目级信息
 * 只存在于 `heading` 里，而 `heading` 本身不进事实源（读出来是
 * 「公司 · 职位」这种电报体，不是句子）。所以要点为空时，工作与项目
 * 必须自己产一条条目级事实，否则整段经历在自我介绍里完全不存在 ——
 * 而它可能正是最相关的一段。**学业不能再产一条**：那会与 heading 事实
 * 说同一件事，重复念一遍，且 id 撞车。
 */
function bulletDrafts(
  sectionId: string,
  index: number,
  pair: PairedEntry,
  kind: IntroFactKind,
  entryFactExists: boolean,
): readonly Draft[] {
  const enParts = pair.en === undefined ? [] : splitHeading(pair.en.heading)
  const zhHead = pair.zhHead
  const zhRole = splitHeading(pair.zh.heading)[1] ?? ''
  const enHead = enParts[0] ?? zhHead
  const enRole = enParts[1] ?? zhRole
  const guide = {
    zh: zhRole === '' ? `在${zhHead}` : `在${zhHead}做${zhRole}期间`,
    en: enRole === '' ? `At ${enHead}` : `At ${enHead} as a ${enRole}`,
  }

  const bullets = pair.zh.bullets
  if (bullets.length === 0) {
    if (entryFactExists) return []
    return [
      {
        id: `${sectionId}.${index}.heading`,
        kind,
        zh: ensurePeriod(`${guide.zh}${zhRole === '' ? '读书' : '工作过'}`, 'zh'),
        en: ensurePeriod(
          enRole === '' ? `${guide.en} I studied` : `${guide.en} I worked`,
          'en',
        ),
      },
    ]
  }

  return bullets.map((zhBullet, bulletIndex) => {
    const enBulletSource = pair.en?.bullets[bulletIndex]
    // 英文侧写了没有 —— 在**这里**判断，因为这里正是「用哪个源」的分叉点。
    // 跑到下游再用 `en === zh` 去猜，猜的是同一件事，却离决定点远了一层。
    const zhFallback = enBulletSource === undefined || enBulletSource === zhBullet
    const enBullet = enBulletSource ?? zhBullet
    const isFirst = bulletIndex === 0
    return {
      id: `${sectionId}.${index}.${bulletIndex}`,
      kind,
      zh: ensurePeriod(isFirst ? `${guide.zh}，${zhBullet}` : zhBullet, 'zh'),
      en: ensurePeriod(isFirst ? `${guide.en}, I ${lowerFirst(enBullet)}` : enBullet, 'en'),
      zhFallback,
    }
  })
}

function skillDrafts(models: IntroModels): readonly Draft[] {
  return pairedEntries(models, 'skills').map((pair, index) => {
    const enHeading = pair.en?.heading ?? pair.zh.heading
    const enList = listOf(pair.en?.bullets ?? pair.zh.bullets, 'en').replace(/ · /g, ', ')
    return {
      id: `skills.${index}`,
      kind: 'skill' as const,
      zh: ensurePeriod(`我的${pair.zh.heading}包括${pair.zh.bullets.join('、')}`, 'zh'),
      en: ensurePeriod(`My ${enHeading} include ${enList}`, 'en'),
    }
  })
}

/**
 * 从**简历的文档模型**里取出自我介绍可用的事实，按 `rank` 排好。
 *
 * 不去「对齐」两边的节：它们来自同一个 `buildDocumentModel`、同一份
 * `SECTION_ORDER`（`model.ts` 里那张表明确说了两个 target 的顺序不分叉），
 * 所以能取到的节 id 集合必然相同。若哪天分叉了，症状是某个节的英文事实
 * 全部回退成中文 —— 那是**看得见**的，不是静默的。
 */
export function introFacts(models: IntroModels): readonly IntroFact[] {
  const drafts: Draft[] = []

  const zhLabel = models.zh.label
  const enLabel = models.en.label
  drafts.push({
    id: 'identity',
    kind: 'identity',
    zh: ensurePeriod(`我是${models.zh.name}${zhLabel === '' ? '' : `，${zhLabel}`}`, 'zh'),
    en: ensurePeriod(`I'm ${models.en.name}${enLabel === '' ? '' : `, ${enLabel}`}`, 'en'),
  })

  if (models.zh.summary.trim() !== '' || models.en.summary.trim() !== '') {
    drafts.push({
      id: 'summary',
      kind: 'summary',
      zh: ensurePeriod(models.zh.summary, 'zh'),
      // `pickLang` 在目标语种字段为空时会回退到另一语种（`model.ts` 的文件头
      // 说明了为什么回退而不是留空）。回退发生在**模型里**，所以到了这里
      // 「两语言相同」已经是既成事实 —— 记一笔，让下游能把「英文侧本来就是
      // 中文」和「英文侧太短」分开说。
      en: ensurePeriod(models.en.summary === '' ? models.zh.summary : models.en.summary, 'en'),
      zhFallback:
        models.zh.summary.trim() !== '' && models.en.summary === models.zh.summary,
    })
  }

  drafts.push(...educationDrafts(models))
  drafts.push(...experienceDrafts(models))
  drafts.push(...projectDrafts(models))
  drafts.push(...skillDrafts(models))

  const counters = new Map<IntroFactKind, number>()
  const facts = drafts.map((draft) => {
    const seq = counters.get(draft.kind) ?? 0
    counters.set(draft.kind, seq + 1)
    return {
      id: draft.id,
      kind: draft.kind,
      rank: KIND_RANK[draft.kind] + seq,
      zh: draft.zh,
      en: draft.en,
      numbers: numbersOf(draft.zh, draft.en),
      zhFallback: draft.zhFallback === true,
    }
  })

  return facts.sort((left, right) => left.rank - right.rank)
}
