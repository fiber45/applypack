/**
 * 从档案抽出可参与匹配的条目。
 *
 * **这是 B 级数据被挡在匹配层之外的唯一入口。** 本文件读一遍档案、
 * 只挑出 A 级子树里的文本，之后整个匹配过程都只接触 `MatchItem`。
 *
 * 用 `unknown` 读取而不是依赖 `ArchiveV1` 的精确类型，是有意的：
 * 档案的字段大量可选、i18n 字段是 `{zh?, en?}`，用类型断言逐个取会让
 * 这个文件变成一堆 `as`。宽进窄出 —— 入口处宽松，出口处是强类型的 `MatchItem`。
 */

import type { ArchiveV1 } from '../schema/index'
import { extractNumbers } from '../verify/numbers'
import type { MatchItem, MatchKind } from './types'

/** 把一个字段摊平成文本数组：字符串给自己，i18n 对象给全部语种的值。 */
function asTexts(value: unknown): readonly string[] {
  if (typeof value === 'string') return value === '' ? [] : [value]
  if (Array.isArray(value)) return value.flatMap(asTexts)
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(asTexts)
  }
  return []
}

/** 取第一个非空字符串，用于标题这类需要单值的场景。 */
function firstText(...values: readonly unknown[]): string {
  for (const value of values) {
    const texts = asTexts(value)
    const hit = texts.find((text) => text.trim() !== '')
    if (hit !== undefined) return hit
  }
  return ''
}

function countQuantified(highlights: readonly string[]): number {
  return highlights.filter((line) => extractNumbers(line).length > 0).length
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/

function asMonth(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return MONTH_PATTERN.test(trimmed) ? trimmed : null
}

interface Collection {
  readonly path: string
  readonly kind: MatchKind
  readonly build: (path: string, entry: Record<string, unknown>) => MatchItem
}

function buildWork(path: string, entry: Record<string, unknown>): MatchItem {
  const highlights = asTexts(entry.highlights)
  const position = entry.position ?? entry.title
  const company = entry.company ?? entry.organization ?? entry.name
  return {
    entryId: `${path}`,
    kind: 'work',
    title: firstText(position),
    organization: firstText(company),
    startDate: asMonth(entry.startDate),
    endDate: asMonth(entry.endDate),
    texts: [...asTexts(position), ...asTexts(company), ...asTexts(entry.summary), ...highlights],
    highlightCount: highlights.length,
    quantifiedCount: countQuantified(highlights),
  }
}

function buildProject(path: string, entry: Record<string, unknown>): MatchItem {
  const highlights = asTexts(entry.highlights)
  return {
    entryId: `${path}`,
    kind: 'project',
    title: firstText(entry.name, entry.title),
    organization: firstText(entry.entity, entry.organization),
    startDate: asMonth(entry.startDate),
    endDate: asMonth(entry.endDate),
    texts: [
      ...asTexts(entry.name),
      ...asTexts(entry.description),
      ...highlights,
      ...asTexts(entry.keywords),
    ],
    highlightCount: highlights.length,
    quantifiedCount: countQuantified(highlights),
  }
}

function buildEducation(path: string, entry: Record<string, unknown>): MatchItem {
  const highlights = asTexts(entry.highlights)
  return {
    entryId: `${path}`,
    kind: 'education',
    title: firstText(entry.area, entry.studyType),
    organization: firstText(entry.institution),
    startDate: asMonth(entry.startDate),
    endDate: asMonth(entry.endDate),
    texts: [
      ...asTexts(entry.institution),
      ...asTexts(entry.area),
      ...asTexts(entry.studyType),
      ...asTexts(entry.gpa),
      ...highlights,
    ],
    highlightCount: highlights.length,
    quantifiedCount: countQuantified(highlights),
  }
}

function buildAward(path: string, entry: Record<string, unknown>): MatchItem {
  return {
    entryId: `${path}`,
    kind: 'award',
    title: firstText(entry.title),
    organization: firstText(entry.awarder),
    startDate: asMonth(entry.date),
    endDate: null,
    texts: [...asTexts(entry.title), ...asTexts(entry.awarder), ...asTexts(entry.summary)],
    highlightCount: 0,
    quantifiedCount: 0,
  }
}

function buildCertificate(path: string, entry: Record<string, unknown>): MatchItem {
  return {
    entryId: `${path}`,
    kind: 'certificate',
    title: firstText(entry.name),
    organization: firstText(entry.issuer),
    startDate: asMonth(entry.date),
    endDate: null,
    texts: [...asTexts(entry.name), ...asTexts(entry.issuer)],
    highlightCount: 0,
    quantifiedCount: 0,
  }
}

const COLLECTIONS: readonly Collection[] = [
  { path: 'work', kind: 'work', build: buildWork },
  { path: 'projects', kind: 'project', build: buildProject },
  { path: 'education', kind: 'education', build: buildEducation },
  { path: 'awards', kind: 'award', build: buildAward },
  { path: 'certificates', kind: 'certificate', build: buildCertificate },
]

/** 抽出全部可匹配条目。顺序固定为「集合声明顺序 + 集合内原始顺序」，以求确定性。 */
export function extractMatchItems(archive: ArchiveV1): readonly MatchItem[] {
  const source = archive as unknown as Record<string, unknown>
  const items: MatchItem[] = []

  for (const collection of COLLECTIONS) {
    const raw = source[collection.path]
    if (!Array.isArray(raw)) continue
    raw.forEach((entry, index) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return
      items.push(collection.build(`${collection.path}.${index}`, entry as Record<string, unknown>))
    })
  }
  return items
}
