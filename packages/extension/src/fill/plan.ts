import type { DataLevel, ArchiveV1 } from '../../../core/src/schema/index'
import {
  adapterBindings,
  detectPlatformAdapter,
} from './adapters'
import { FILL_CATALOG, isFillableKind, type CatalogEntry } from './catalog'
import type { DomDocument } from './dom'
import { extractFieldFeatures, type FieldFeature } from './features'
import { normalizeLabeling, scoreCatalogEntry } from './heuristics'

/**
 * 填充计划 —— 本层是「读页面」与「写页面」之间唯一的关口。
 *
 * 输出是**纯数据**（key / path / value / 级别 / 来源 / 必填）：
 * 真正写 DOM 的事在 T5.3 预览确认 UI 手里 —— 用户逐项确认之前，
 * 这里不存在任何能碰到页面的函数。这同时是可测性的来源：
 * 本文件的判据全部跑在保存的 HTML fixture 上，不依赖真实站点（T5.1）。
 *
 * ## 判别联合的分支即语义（「填错比不填更糟」，DESIGN 3.4）
 *
 * | 分支 | 含义 | 预览 UI 的呈现 |
 * |---|---|---|
 * | `fill` | 有把握的候选：path 确定、值来自档案 | 按 source 区分 adapter / heuristic |
 * | `gap` | 不填。`reason` 说明为什么不 | 缺口聚合提示（DESIGN 11.2） |
 * | `file-slot` | 上传槽位：**只提示不代填**（红线 5） | 槽位提示，T5.4 细化 |
 *
 * checkbox（同意条款）不出现在任何分支 —— 用户必须自己勾，
 * 「替用户同意」比填错任何字段都严重。
 */

export type FillGapReason =
  | 'no-catalog-match' // 页面字段在目录里没有词汇可对 —— 不是档案的错
  | 'no-value'         // 目录认得这个字段，但档案里是空的 —— DESIGN 11 的真缺口
  | 'ambiguous'        // 两个以上字段并列最高分 —— 一个都不填
  | 'outbid'           // 有信号但输给了别的字段 —— 例如「紧急联系人电话」对上手机
  | 'option-mismatch'  // 档案有值但下拉选项里没有 —— 站点选项集与档案脱节

export type FillPlanItem =
  | {
      readonly kind: 'fill'
      readonly key: string
      readonly path: string
      readonly value: string
      readonly level: DataLevel
      readonly source: 'adapter' | 'heuristic'
      readonly required: boolean
    }
  | {
      readonly kind: 'gap'
      readonly key: string
      readonly reason: FillGapReason
      /** 已知「它想填哪个字段」时带上 —— 预览 UI 靠它解释缺口 */
      readonly path: string | null
      readonly blocking: boolean
    }
  | {
      readonly kind: 'file-slot'
      readonly key: string
      readonly required: boolean
    }

export interface FillPlan {
  readonly items: readonly FillPlanItem[]
}

interface Candidate {
  readonly feature: FieldFeature
  readonly entry: CatalogEntry
  readonly score: number
}

export function buildFillPlan(doc: DomDocument, archive: ArchiveV1): FillPlan {
  const features = extractFieldFeatures(doc)
  const knownKeys = new Set(features.map((f) => f.key))

  const adapter = detectPlatformAdapter(doc)
  const bindings = adapter === null
    ? new Map<string, string>()
    : adapterBindings(adapter, doc, knownKeys)
  const adapterPaths = new Set(bindings.values())

  // —— 决策表：key → 最终归宿 ——
  const decisions = new Map<string, FillPlanItem>()

  // ① 适配器绑定优先：path 由人工选择器指定，值仍走同一条校验管道。
  for (const feature of features) {
    const path = bindings.get(feature.key)
    if (path === undefined) continue
    const entry = FILL_CATALOG.find((e) => e.path === path)
    if (entry === undefined) continue // 防御：注册表指向了不存在的目录路径
    decisions.set(feature.key, resolveFill(feature, entry, archive, 'adapter'))
  }

  // ② 启发式候选：按 path 分组竞标。
  const byPath = new Map<string, Candidate[]>()
  for (const feature of features) {
    if (decisions.has(feature.key)) continue
    if (!isFillableKind(feature.kind)) continue
    for (const entry of FILL_CATALOG) {
      if (adapterPaths.has(entry.path)) continue // 适配器已认领的 path 不参与竞标
      const score = scoreCatalogEntry(entry, feature)
      if (score <= 0) continue
      const list = byPath.get(entry.path) ?? []
      list.push({ feature, entry, score })
      byPath.set(entry.path, list)
    }
  }

  for (const [path, candidates] of byPath) {
    // 分数降序；同分按 DOM 序（features 的原始顺序即候选收集顺序，
    // Array.prototype.sort 在现代引擎是稳定的，且这里 tie-break 语义
    // 本来就是「先出现在页面上的赢」）。
    candidates.sort((a, b) => b.score - a.score)
    const top = candidates[0]
    if (top === undefined) continue // 不可达：byPath 的值只在 push 过候选后存在
    const second = candidates[1]

    if (second !== undefined && second.score === top.score) {
      // 并列最高 = 分不清谁是目标。**一个都不填**：填错的代价
      // （一次网申直接报废）远大于不填（用户手填 30 秒）。
      for (const candidate of candidates.filter((c) => c.score === top.score)) {
        decisions.set(candidate.feature.key, {
          kind: 'gap',
          key: candidate.feature.key,
          reason: 'ambiguous',
          path,
          blocking: candidate.feature.required,
        })
      }
      continue
    }

    decisions.set(top.feature.key, resolveFill(top.feature, top.entry, archive, 'heuristic'))
    for (const loser of candidates.slice(1)) {
      decisions.set(loser.feature.key, {
        kind: 'gap',
        key: loser.feature.key,
        reason: 'outbid',
        path,
        blocking: loser.feature.required,
      })
    }
  }

  // ③ 没有任何信号的普通字段、以及 file / checkbox 的归宿。
  for (const feature of features) {
    if (decisions.has(feature.key)) continue
    if (feature.kind === 'file') {
      decisions.set(feature.key, { kind: 'file-slot', key: feature.key, required: feature.required })
      continue
    }
    if (feature.kind === 'checkbox') continue // 用户必须自己勾，见文件头
    decisions.set(feature.key, {
      kind: 'gap',
      key: feature.key,
      reason: 'no-catalog-match',
      path: null,
      blocking: feature.required,
    })
  }

  // ④ 按页面顺序输出 —— 预览 UI 的行序和表单一致，用户才能对上。
  const items: FillPlanItem[] = []
  for (const feature of features) {
    const item = decisions.get(feature.key)
    if (item !== undefined) items.push(item)
  }
  return { items }
}

/**
 * 候选 → fill 或 gap 的最终裁决。adapter 与 heuristic 的候选走**同一条**
 * 校验（值存在性、select 选项匹配）—— 来源只影响预览 UI 的标注，
 * 不影响「什么才有资格被填」。
 */
function resolveFill(
  feature: FieldFeature,
  entry: CatalogEntry,
  archive: ArchiveV1,
  source: 'adapter' | 'heuristic',
): FillPlanItem {
  const key = feature.key
  const required = feature.required

  const value = entry.read(archive)
  if (value === null) {
    return { kind: 'gap', key, reason: 'no-value', path: entry.path, blocking: required }
  }

  if (feature.options !== null) {
    // select 与 radio 组同走此路：按选项**文本**匹配（用户看到的是文本），
    // 回填写 option 的 value（表单真正提交的是它；radio 则是要点中的那个成员）。
    const normalizedValue = normalizeLabeling(value)
    const matched = feature.options.find(
      (option) => normalizeLabeling(option.text) === normalizedValue,
    )
    if (matched === undefined) {
      return {
        kind: 'gap',
        key,
        reason: 'option-mismatch',
        path: entry.path,
        blocking: required,
      }
    }
    return {
      kind: 'fill',
      key,
      path: entry.path,
      value: matched.value !== '' ? matched.value : matched.text,
      level: entry.level,
      source,
      required,
    }
  }

  return { kind: 'fill', key, path: entry.path, value, level: entry.level, source, required }
}
