import type { DataLevel, ArchiveV1 } from '../../../core/src/schema/index'

/**
 * 可填字段目录 —— 启发式匹配与适配器的**共同词汇表**。
 *
 * 每个条目回答四件事：
 *   1. `path`  —— 值从档案的哪里来（也是 plan / 预览 UI 的寻址键）
 *   2. `level` —— A 还是 B。填充是 B 级数据**唯一合法的消费场景**
 *      （DESIGN 1.3），所以本文件在 extension 包里，不在 core ——
 *      core 的红线 1 是「任何函数不得读取 B 级字段」，而这张表的
 *      `read` 函数就是要读它们。
 *   3. `synonyms` —— 长尾站点的中文同义词表 + 常见英文
 *   4. `kinds`   —— 类型闸门：`<input type="tel">` 永远不可能接 email 的值
 *
 * `level` 与 core 分级策略的一致性由测试钉死（plan.test.ts）：
 * 目录抄错了级别，红灯亮在填表之前，而不是等预览 UI 展示错了才被发现。
 */

export interface CatalogEntry {
  readonly path: string
  readonly level: DataLevel
  readonly synonyms: readonly string[]
  readonly kinds: readonly FieldKindForFill[]
  /** 从档案读值。null = 档案里没有（真缺口，DESIGN 11 的缺失提示对象）。 */
  readonly read: (archive: ArchiveV1) => string | null
}

export type FieldKindForFill =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'month'
  | 'select'
  | 'textarea'

/** 可填的 kind 全集（file / checkbox / radio 刻意不在内）。 */
export const FILLABLE_KINDS: readonly FieldKindForFill[] = Object.freeze([
  'text',
  'email',
  'tel',
  'url',
  'number',
  'date',
  'month',
  'select',
  'textarea',
])

export function isFillableKind(kind: string): boolean {
  return (FILLABLE_KINDS as readonly string[]).includes(kind)
}

export const FILL_CATALOG: readonly CatalogEntry[] = Object.freeze([
  {
    path: 'basics.name.zh',
    level: 'B',
    synonyms: ['姓名', '名字', 'name', 'full name'],
    kinds: ['text'],
    read: (a) => a.basics.name?.zh ?? null,
  },
  {
    path: 'basics.label.zh',
    level: 'A',
    synonyms: ['求职意向', '期望职位', '意向岗位', '应聘岗位', 'desired position', 'job intent'],
    kinds: ['text'],
    read: (a) => a.basics.label?.zh ?? null,
  },
  {
    path: 'basics.contact.email',
    level: 'B',
    synonyms: ['邮箱', '电子邮箱', '电子邮件', 'email', 'e-mail'],
    kinds: ['text', 'email'],
    read: (a) => a.basics.contact.email ?? null,
  },
  {
    path: 'basics.contact.phone',
    level: 'B',
    synonyms: ['手机', '手机号', '电话', '联系电话', 'phone', 'mobile', 'tel', 'telephone'],
    kinds: ['text', 'tel'],
    read: (a) => a.basics.contact.phone ?? null,
  },
  {
    path: 'basics.contact.wechat',
    level: 'B',
    synonyms: ['微信', '微信号', 'wechat', 'weixin'],
    kinds: ['text'],
    read: (a) => a.basics.contact.wechat ?? null,
  },
  {
    path: 'basics.location.city',
    level: 'B',
    synonyms: ['城市', '所在城市', '期望城市', '工作城市', 'city'],
    kinds: ['text', 'select'],
    read: (a) => a.basics.location?.city ?? null,
  },
  {
    path: 'basics.identity.gender',
    level: 'B',
    synonyms: ['性别', 'gender'],
    kinds: ['text', 'select'],
    read: (a) => a.basics.identity.gender ?? null,
  },
  {
    path: 'basics.identity.birthDate',
    level: 'B',
    synonyms: ['出生日期', '出生年月', '生日', 'birth date', 'birthday'],
    kinds: ['text', 'date', 'month'],
    read: (a) => a.basics.identity.birthDate ?? null,
  },
  {
    path: 'basics.desiredSalary.amount',
    level: 'B',
    synonyms: ['期望月薪', '期望薪资', '月薪', '薪资', 'expected salary', 'salary'],
    kinds: ['text', 'number'],
    read: (a) =>
      a.basics.desiredSalary?.amount === undefined
        ? null
        : String(a.basics.desiredSalary.amount),
  },
  {
    path: 'basics.summary.zh',
    level: 'A',
    synonyms: ['自我介绍', '自我评价', '个人简介', '简介', 'self introduction', 'summary', 'intro'],
    kinds: ['textarea', 'text'],
    read: (a) => a.basics.summary?.zh ?? null,
  },
  {
    path: 'education.0.institution',
    level: 'A',
    synonyms: ['毕业院校', '学校', '院校', 'university', 'school', 'college'],
    kinds: ['text'],
    read: (a) => a.education[0]?.institution ?? null,
  },
  {
    path: 'education.0.studyType.zh',
    level: 'A',
    synonyms: ['学历', '最高学历', 'degree', 'education level'],
    kinds: ['text', 'select'],
    read: (a) => a.education[0]?.studyType?.zh ?? null,
  },
  {
    path: 'education.0.area.zh',
    level: 'A',
    synonyms: ['专业', '所学专业', 'major'],
    kinds: ['text'],
    read: (a) => a.education[0]?.area?.zh ?? null,
  },
  {
    path: 'education.0.endDate',
    level: 'A',
    synonyms: ['毕业时间', '毕业年月', 'graduation', 'graduation date'],
    kinds: ['text', 'date', 'month'],
    read: (a) => a.education[0]?.endDate ?? null,
  },
])

/**
 * 目录的可 filling 性（isFillableKind）与条目的 kinds 集合之间
 * 由测试对齐（plan.test.ts）—— file / checkbox 永不出现在任何条目里，
 * 这是红线 5（不代填 file）在词汇表层的形状。
 */
