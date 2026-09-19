/**
 * 校招一页档案 —— T4b 的验收样本。
 *
 * ## 为什么不能直接用 `maximalArchiveV1`
 *
 * 那份样本的用途是**字段覆盖**（每个叶子路径都要能被分级策略覆盖），
 * 所以它把每个可选字段都填满了 —— 那是它的价值，也是它当不了投递包样本的原因：
 * 填满全部字段的档案必然超过一页，于是「EN 版 == 1 页」这条断言只能靠
 * 放宽版式常量来通过，而那等于把断言删掉。
 *
 * 本样本按**真实的校招一页简历**来写，取舍与真实用户做的取舍一致：
 *
 * - 保留：教育、实习、项目、技能、语言
 * - **去掉：荣誉奖项、证书** —— 不是漏了。一页的代价就是砍掉这些，
 *   而「先砍哪个」正是「一页」这条约束真正在逼用户回答的问题。
 * - 实习与项目各只留 2 条要点（真实一页简历的常见条数）
 *
 * ## 数字被刻意对齐过 —— 但这是**样本的性质**，不是校验的性质
 *
 * 中英两版的`position` / `area` / 节标题各按语种取，而 `highlights` 是一个
 * 数组两语共用。本样本里各语种的本地化字段都**不含数字**，所以数字对齐
 * 完全取决于要点：`rewritten.zh` 与 `rewritten.en` 由两段**互不相关**的
 * 英文 / 中文改写产生，却写的是同一组事实（12 / 4.2 / 38）。
 *
 * 这是 T4b 第二条勾要求的样子：**两侧事实源独立，数字集合仍然相等**。
 * 若没有那两个 map，两侧要点逐字相同，数字相等就是构造性的 ——
 * 那种情况下 `crossLanguageParity` 会如实报 `nothing_to_verify`，
 * `package.test.ts` 里专门有一条断言守着这个区别。
 *
 * 与 `maximal-archive.ts` 一样：本文件里出现的所有值均为**虚构**，
 * 手机号为满足格式的编造值，不对应任何真实个人。
 */
import type { ArchiveV1 } from '../../schema/index'
import type { RenderLang } from '../model'

export const campusArchiveV1 = {
  schemaVersion: 1,
  basics: {
    name: { zh: '林知远', en: 'Lin Zhiyuan' },
    label: { zh: '算法工程应届生', en: 'Algorithm Engineer, New Grad' },
    summary: {
      zh: '计算机科学本科应届生，一段推荐系统实习加一个完整项目，熟悉特征工程与离线到在线的指标闭环。',
      en: 'CS undergraduate with a recommender-system internship and a full project; comfortable with feature engineering and offline-to-online metric loops.',
    },
    location: { city: '杭州' },
    contact: {
      email: 'linzhiyuan@example.com',
      phone: '+8613800138000',
    },
    // `basics` 上的这三项在 schema 里带 `.default`，于是 `z.infer` 的产出类型
    // 里它们是**必填** —— 手写档案必须显式写出（见 `archive.ts` 里
    // 「basics 本身不给默认值」那段说明）。
    identity: {},
    profiles: [],
  },
  work: [
    {
      company: '杭州某某科技有限公司',
      position: { zh: '算法工程实习生', en: 'Algorithm Engineering Intern' },
      startDate: '2025-06',
      endDate: '2025-09',
      location: '杭州',
      highlights: [
        '负责召回通道的特征工程，累计上线 12 个特征',
        '将离线特征回填耗时从 4.2 小时降至 38 分钟',
      ],
    },
  ],
  education: [
    {
      institution: '某某大学',
      area: { zh: '计算机科学与技术', en: 'Computer Science' },
      studyType: { zh: '本科', en: "Bachelor's Degree" },
      startDate: '2022-09',
      endDate: '2026-06',
      gpa: '3.7/4.0',
      highlights: [],
    },
  ],
  projects: [
    {
      name: { zh: '校园二手交易推荐系统', en: 'Campus Marketplace Recommender' },
      description: {
        zh: '协同过滤与内容特征混合的推荐服务。',
        en: 'Hybrid recommender combining collaborative filtering and content features.',
      },
      highlights: ['把首页点击率从 18% 提到 27%'],
      keywords: ['推荐系统', '协同过滤'],
      startDate: '2025-03',
      endDate: '2025-05',
    },
  ],
  skills: [
    { name: { zh: '编程语言', en: 'Languages' }, keywords: ['Python', 'SQL'] },
    { name: { zh: '机器学习', en: 'Machine Learning' }, keywords: ['PyTorch', 'LightGBM'] },
  ],
  languages: [
    { language: { zh: '英语', en: 'English' }, fluency: 'CET-6', score: '562' },
    { language: { zh: '普通话', en: 'Mandarin' }, fluency: '母语' },
  ],
  certificates: [],
  awards: [],
  customFields: {},
} satisfies ArchiveV1

/**
 * 两段**互不相关**的改写产物：中文那一版来自中文改写调用，
 * 英文那一版来自英文改写调用。它们写的是同一组事实 ——
 * 这正是 DESIGN 10.2 要求校验的东西，也是它可能被违反的地方。
 */
export const campusRewritten: Partial<
  Record<RenderLang, ReadonlyMap<string, readonly string[]>>
> = {
  zh: new Map<string, readonly string[]>([
    [
      'work.0',
      ['主导召回通道的特征工程，上线 12 个特征', '把离线特征回填耗时从 4.2 小时压到 38 分钟'],
    ],
  ]),
  en: new Map<string, readonly string[]>([
    [
      'work.0',
      [
        'Shipped 12 features for the recall channel',
        'Cut offline backfill time from 4.2 hours to 38 minutes',
      ],
    ],
  ]),
}
