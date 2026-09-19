import { deserializeArchive, serializeArchive, type ArchiveV1 } from '../../../core/src/schema/index'
import { FILL_CATALOG } from './catalog'
import type { FillPlan } from './plan'

/**
 * 回填闭环 —— 「填一次，以后自动」（TASKS T5.6，DESIGN 11.3）。
 *
 * 用户在某次网申中手填了档案里没有（或不同）的值 → 询问「要保存到
 * 档案吗？」→ 确认后写回。DESIGN 11.3 的三条纪律在纯逻辑层的落点：
 *
 * - **不静默保存**：`applyBackfill` 只写 decisions 里显式点头的条目，
 *   空决策 = 档案逐字节不变。检测（detect / build）与写回（apply）
 *   之间没有任何直达路径 —— 「检测到候选」永远不会自己变成「写入」。
 * - **冲突不自动覆盖**：conflict 条目（档案已有不同值）没有决策 =
 *   保留档案值。**keep 是缺省，不是 replace** —— 展示两个值让用户选
 *   是 UI 的事，「选了才覆盖」在这里是结构。
 * - **不污染档案形状**：写回走 path 白名单（`BACKFILL_PATHS`，与
 *   FILL_CATALOG 一一对称，测试钉死双向相等），产出必过严格 schema
 *   round-trip。语义未知的字段只有 `customFields` 一条路（schema 的
 *   唯一开放槽位，级别策略里默认 B 级）。
 *
 * 「写回并重建索引」的可执行判定：写回后的档案用 `FILL_CATALOG` 的
 * `read` 能读回页面值 —— 下一次 `buildFillPlan` 就能自动填上它。
 * 这就是「索引」的全部含义：词汇表与档案重新对上号。
 *
 * ## 指纹
 *
 * proposal 绑定检测时刻的档案序列化（`serializeArchive`，同步纯函数）。
 * apply 时重新计算比对：检测之后档案被 web 端改过 → 旧 proposal 作废，
 * 重新检测 —— 与 T5.3 确认凭据、T5.5 放行凭据同一套机制，只是这里的
 * 「世界」是档案而不是页面。
 */

export type BackfillSource =
  | 'edited' // 我们填过、用户改掉了 —— 用户的选择比计划的新
  | 'manual' // 我们没填（缺口）、用户自己填了

export type BackfillTarget =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'custom'; readonly cfKey: string }

export interface BackfillCandidate {
  /** plan 字段 key —— 候选的稳定标识。 */
  readonly key: string
  readonly target: BackfillTarget
  /** 提交时刻页面上的值（trim 过的非空串才有资格成为候选）。 */
  readonly pageValue: string
  readonly source: BackfillSource
}

/**
 * 手填检测：对比提交时刻的表单值与当时的计划。
 *
 * 规则刻意保守：页面值与计划值相同（我们填的还在）、或为空白
 * （用户清空不是新信息）、或字段根本没有页面值 —— 都不算手填。
 * file-slot / checkbox 不在 fill/gap 分支里，天然不进候选。
 */
export function detectBackfillCandidates(
  plan: FillPlan,
  pageValues: Readonly<Record<string, string>>,
): BackfillCandidate[] {
  const candidates: BackfillCandidate[] = []

  for (const item of plan.items) {
    const pageValue = pageValues[item.key]
    if (pageValue === undefined) continue
    const trimmed = pageValue.trim()
    if (trimmed === '') continue

    if (item.kind === 'fill') {
      if (trimmed === item.value) continue // 计划值原样在页面上 —— 用户没动它
      candidates.push({
        key: item.key,
        target: { kind: 'path', path: item.path },
        pageValue: trimmed,
        source: 'edited',
      })
      continue
    }

    if (item.kind === 'gap') {
      // outbid / ambiguous 不回填：这两种缺口的 path 归属已经被计划
      // 判为**不可信** —— 「紧急联系人电话」「备用联系电话」被词汇表
      // 对上 `basics.contact.phone` 再被挤掉，用户手填它，回填进 phone
      // 就是污染档案。「填错比不填更糟」在回填方向的镜像是：
      // **存错比不存更糟**。这些字段值得存的话，该由用户在档案里
      // 显式录入，而不是由猜测通道代劳。
      if (item.reason === 'outbid' || item.reason === 'ambiguous') continue
      candidates.push({
        key: item.key,
        target:
          item.path !== null
            ? { kind: 'path', path: item.path }
            : { kind: 'custom', cfKey: item.key }, // 目录认不出 ⇒ 语义未知 ⇒ customFields（B 级）
        pageValue: trimmed,
        source: 'manual',
      })
    }
  }

  return candidates
}

export interface BackfillItem {
  readonly id: string
  readonly target: BackfillTarget
  readonly pageValue: string
  /** 档案现值的可展示形态；null = 档案没有（new）。 */
  readonly archiveValue: string | null
  readonly status: 'new' | 'conflict'
}

export interface BackfillProposal {
  /** 检测时刻档案的序列化指纹 —— apply 时验证档案没被别人改过。 */
  readonly fingerprint: string
  readonly items: readonly BackfillItem[]
}

/** customFields 值的可展示形态：字符串原样，其余 JSON 化。 */
function stringifyCustom(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * 按档案现值分诊。`same`（页面值恰好等于档案值）在这里被丢弃 ——
 * 「手填了一个档案已有的值」没有信息量，问它就是打扰。
 */
export function buildBackfillProposal(
  candidates: readonly BackfillCandidate[],
  archive: ArchiveV1,
): BackfillProposal {
  const entries = FILL_CATALOG.map((e) => [e.path, e] as const)
  const entryByPath = new Map(entries)

  const items: BackfillItem[] = []
  for (const candidate of candidates) {
    if (candidate.target.kind === 'path') {
      const entry = entryByPath.get(candidate.target.path)
      // 目录里没有这个 path 是不可能的：detect 的 path 候选全部来自
      // 计划，而计划里的 path 只出自目录。防御性拒绝胜过静默读 null。
      if (entry === undefined) {
        throw new Error(
          `buildBackfillProposal：候选路径「${candidate.target.path}」不在目录里 —— 候选与目录不配套`,
        )
      }
      const archiveValue = entry.read(archive)
      if (archiveValue === candidate.pageValue) continue // same：没有信息量
      items.push({
        id: candidate.key,
        target: candidate.target,
        pageValue: candidate.pageValue,
        archiveValue,
        status: archiveValue === null ? 'new' : 'conflict',
      })
      continue
    }

    const existing = archive.customFields[candidate.target.cfKey]
    if (existing !== undefined && stringifyCustom(existing) === candidate.pageValue) continue
    items.push({
      id: candidate.key,
      target: candidate.target,
      pageValue: candidate.pageValue,
      archiveValue: existing === undefined ? null : stringifyCustom(existing),
      status: existing === undefined ? 'new' : 'conflict',
    })
  }

  return { fingerprint: serializeArchive(archive), items }
}

/** 用户的一次决策：点头 = 采纳页面值。没有「改写成别的值」的选项 —— 那是编辑档案，不是回填。 */
export interface BackfillDecision {
  readonly id: string
}

/**
 * 写回白名单：path → 不可变更新。与 `FILL_CATALOG` 一一对称
 * （`BACKFILL_PATHS` 的测试断言钉死双向相等）—— 目录加了条目而这里
 * 没有写回通道，红灯亮在回填测试里，而不是亮在用户「填了却不记住」的
 * 体验里。对称性的另一半（这里多出目录没有的 path）同样不允许：
 * 白名单是 catalog 的投影，不是平行词汇表。
 *
 * 前置条件：父容器存在（`education` 条目、`basics.location` 等）。
 * 无法满足时抛错并把话说全 —— `education.0.endDate` 这类字段在
 * 没有教育条目时造不出来（`institution` 是必填），回填它没有意义，
 * 该去 web 端补的是整条教育经历，不是一个字段。
 */
const WRITERS: Readonly<Record<string, (archive: ArchiveV1, value: string) => ArchiveV1>> = {
  'basics.name.zh': (a, v) => ({
    ...a,
    basics: { ...a.basics, name: { ...a.basics.name, zh: v } },
  }),
  'basics.label.zh': (a, v) => ({
    ...a,
    basics: { ...a.basics, label: { ...a.basics.label, zh: v } },
  }),
  'basics.summary.zh': (a, v) => ({
    ...a,
    basics: { ...a.basics, summary: { ...a.basics.summary, zh: v } },
  }),
  'basics.contact.email': (a, v) => ({
    ...a,
    basics: { ...a.basics, contact: { ...a.basics.contact, email: v } },
  }),
  'basics.contact.phone': (a, v) => ({
    ...a,
    basics: { ...a.basics, contact: { ...a.basics.contact, phone: v } },
  }),
  'basics.contact.wechat': (a, v) => ({
    ...a,
    basics: { ...a.basics, contact: { ...a.basics.contact, wechat: v } },
  }),
  'basics.location.city': (a, v) => ({
    ...a,
    basics: { ...a.basics, location: { ...a.basics.location, city: v } },
  }),
  'basics.identity.gender': (a, v) => ({
    ...a,
    basics: { ...a.basics, identity: { ...a.basics.identity, gender: v } },
  }),
  'basics.identity.birthDate': (a, v) => ({
    ...a,
    basics: { ...a.basics, identity: { ...a.basics.identity, birthDate: v } },
  }),
  'basics.desiredSalary.amount': (a, v) => {
    // 目录 read 时 String() 过，写回必须还原成 number —— 这是档案
    // schema（z.number()）的要求。站点手填带单位（「25k」）在这里炸，
    // 由调用方提示用户改档案，而不是悄悄存进一个坏值。
    const amount = Number(v)
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`applyBackfill：「${v}」不是合法的期望薪资数字，请到档案中直接修改`)
    }
    return {
      ...a,
      basics: {
        ...a.basics,
        desiredSalary: { ...a.basics.desiredSalary, amount },
      },
    }
  },
  'education.0.institution': (a, v) => {
    if (a.education.length === 0) {
      return { ...a, education: [{ institution: v, highlights: [] }] }
    }
    return {
      ...a,
      education: a.education.map((item, index) => (index === 0 ? { ...item, institution: v } : item)),
    }
  },
  'education.0.studyType.zh': (a, v) => requireEducationItem(a, (item) => ({ ...item, studyType: { ...item.studyType, zh: v } })),
  'education.0.area.zh': (a, v) => requireEducationItem(a, (item) => ({ ...item, area: { ...item.area, zh: v } })),
  'education.0.endDate': (a, v) => requireEducationItem(a, (item) => ({ ...item, endDate: v })),
}

function requireEducationItem(
  archive: ArchiveV1,
  update: (item: ArchiveV1['education'][number]) => ArchiveV1['education'][number],
): ArchiveV1 {
  const first = archive.education[0]
  if (first === undefined) {
    throw new Error(
      'applyBackfill：档案还没有教育经历，无法回填其字段 —— 请先在档案中补充教育经历',
    )
  }
  return { ...archive, education: archive.education.map((item, index) => (index === 0 ? update(item) : item)) }
}

/** 写回白名单的键集 —— 供对称性断言与 UI 判断「这条候选能否写回」。 */
export const BACKFILL_PATHS: readonly string[] = Object.freeze(Object.keys(WRITERS))

/**
 * 写回。**只写 decisions 里点头的条目**；conflict 没有决策 = 保留
 * 档案值（keep 是缺省）。产出过严格 schema round-trip：
 * deserialize(serialize(draft)) —— 手填值违反档案形状（日期格式、
 * 非法数字）在这里炸，而不是等保存密文时才炸；顺带完成归一化。
 */
export function applyBackfill(
  archive: ArchiveV1,
  proposal: BackfillProposal,
  decisions: readonly BackfillDecision[],
): ArchiveV1 {
  // 指纹校验：检测之后档案被 web 端改过 → 旧 proposal 作废。
  if (proposal.fingerprint !== serializeArchive(archive)) {
    throw new Error(
      'applyBackfill：提案基于的档案与当前档案不一致 —— 档案在检测之后变过，请重新检测',
    )
  }

  const itemById = new Map(proposal.items.map((item) => [item.id, item]))
  let draft = archive

  for (const decision of decisions) {
    const item = itemById.get(decision.id)
    if (item === undefined) {
      throw new Error(
        `applyBackfill：决策「${decision.id}」不在提案里 —— 决策与提案不配套，拒绝而不静默忽略`,
      )
    }

    if (item.target.kind === 'custom') {
      draft = {
        ...draft,
        customFields: { ...draft.customFields, [item.target.cfKey]: item.pageValue },
      }
      continue
    }

    const writer = WRITERS[item.target.path]
    if (writer === undefined) {
      throw new Error(
        `applyBackfill：路径「${item.target.path}」不在写回白名单里 —— 目录与回填通道漂移，先修对称性`,
      )
    }
    draft = writer(draft, item.pageValue)
  }

  // 严格模式 round-trip：形状违规（日期格式、负数薪资……）在此抛出。
  return deserializeArchive(serializeArchive(draft))
}
