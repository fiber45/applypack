/**
 * 动词表与开头检测。
 *
 * DESIGN 8.6 把「强动词开头」列为 100% 硬约束、「被动语态出现」列为 0 容忍。
 * 两条都靠本文件判定。
 *
 * **关于词表的归属**：这些表最终应当搬到 `knowledge/`（AGENTS.md §3 说的
 * 「术语表 / few-shot 范例 / JD 黑话词典」，唯一对社区开放的模块）。
 * 现在内联在 core 里，是因为 `knowledge/` 包还没建 —— 而一个空目录不构成理由，
 * 让闸门晚一天生效。搬迁会给社区留出一个明确的贡献点。
 *
 * **关于误报**：白名单式检测必然误伤（「累计上线 12 个特征」会被判为
 * 弱开头，因为首二字是「累计」）。这个代价是有意接受的：闸门的用途是
 * 逼出改写，而误报的修法是换一个动词 —— 一次几秒钟的编辑。
 * 反过来，如果为了让所有输入都通过而放宽词表，闸门就失去了作用。
 */

/** 中文强动词（取前两字即可覆盖「负责了」「负责过」这类变体）。 */
export const ZH_STRONG_VERBS: readonly string[] = Object.freeze([
  '负责', '主导', '设计', '实现', '搭建', '构建', '开发', '优化', '重构', '推动',
  '落地', '牵头', '沉淀', '制定', '完成', '提升', '降低', '缩短', '支撑', '驱动',
  '输出', '交付', '维护', '排查', '定位', '治理', '迁移', '集成', '验证', '复现',
  '撰写', '组织', '规划', '建立', '完善', '改造', '升级', '替换', '引入', '上线',
  '推进', '协调', '管理', '执行', '分析', '建模', '训练', '部署', '监控', '调优',
  '清洗', '抽取', '聚合', '编排', '梳理', '起草', '审核', '复盘', '跟进', '复现',
])

/** 英文强动词。过去式与原形都收 —— 简历里两种写法都常见。 */
export const EN_STRONG_VERBS: readonly string[] = Object.freeze([
  'led', 'lead', 'built', 'build', 'designed', 'design', 'implemented', 'implement',
  'optimized', 'optimize', 'reduced', 'reduce', 'increased', 'increase', 'shipped', 'ship',
  'launched', 'launch', 'drove', 'drive', 'architected', 'automated', 'automate',
  'migrated', 'migrate', 'delivered', 'deliver', 'improved', 'improve', 'achieved', 'achieve',
  'created', 'create', 'developed', 'develop', 'spearheaded', 'established', 'establish',
  'owned', 'own', 'managed', 'manage', 'coordinated', 'coordinate', 'analyzed', 'analyze',
  'modeled', 'modelled', 'trained', 'train', 'deployed', 'deploy', 'monitored', 'monitor',
  'tuned', 'tune', 'refactored', 'refactor', 'streamlined', 'streamline', 'scaled', 'scale',
  'standardized', 'standardise', 'standardize', 'introduced', 'introduce', 'replaced', 'replace',
  'upgraded', 'upgrade', 'maintained', 'maintain', 'resolved', 'resolve', 'diagnosed', 'diagnose',
  'validated', 'validate', 'reproduced', 'reproduce', 'authored', 'author', 'organized', 'organize',
  'mentored', 'mentor', 'planned', 'plan', 'executed', 'execute', 'reviewed', 'review',
  'documented', 'document', 'quantified', 'quantify', 'accelerated', 'accelerate',
  'grew', 'grow', 'won', 'win', 'published', 'publish', 'presented', 'present',
  'contributed', 'contribute', 'engineered', 'engineer', 'automated', 'derived', 'derive',
])

/**
 * 弱开头。优先级高于强动词白名单 —— 命中它就是明确的坏，而不只是「不在白名单里」。
 * 分开的理由是错误消息：告诉作者「别用『参与』」比告诉他「换个动词」有用得多。
 */
export const WEAK_OPENERS: readonly string[] = Object.freeze([
  '参与', '协助', '配合', '帮忙', '辅助', '支持了',
  'responsible for', 'worked on', 'helped', 'assisted', 'assisted in', 'participated',
  'participated in', 'involved in', 'was responsible', 'were responsible', 'in charge of',
  'duties included', 'tasked with',
])

const ZH_VERB_SET: ReadonlySet<string> = new Set(ZH_STRONG_VERBS)
const EN_VERB_SET: ReadonlySet<string> = new Set(EN_STRONG_VERBS.map((verb) => verb.toLowerCase()))

/** 汉字占比是否达到三分之一 —— 用于在中文与英文规则之间做选择。 */
export function isCjkDominant(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  return cjk * 3 >= text.length
}

/**
 * 取开头的判定单元：中文取首二字，英文取首个词（小写）。
 * 返回 null 表示文本为空或开头不是文字。
 */
export function leadingToken(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (isCjkDominant(trimmed)) {
    const match = /^[\u4e00-\u9fff]{2}/.exec(trimmed)
    return match?.[0] ?? null
  }
  const match = /^[A-Za-z]+/.exec(trimmed)
  return match?.[0]?.toLowerCase() ?? null
}

/** 命中的弱开头（原样返回，用于错误消息）；没有则 null。 */
export function weakOpener(text: string): string | null {
  const lowered = text.trim().toLowerCase()
  for (const opener of WEAK_OPENERS) {
    if (lowered.startsWith(opener.toLowerCase())) return opener
  }
  return null
}

/** 开头是否为强动词。 */
export function isStrongOpening(text: string): boolean {
  const token = leadingToken(text)
  if (token === null) return false
  if (/^[\u4e00-\u9fff]/.test(token)) return ZH_VERB_SET.has(token)
  return EN_VERB_SET.has(token)
}

const ZH_PASSIVE = /被(?!动)/
const EN_PASSIVE = /\b(?:was|were|been|being|is|are|am)\s+[a-z]+(?:ed|en|wn|lt|ld)\b/i

/** 是否含被动语态。 */
export function hasPassiveVoice(text: string): boolean {
  return ZH_PASSIVE.test(text) || EN_PASSIVE.test(text)
}
