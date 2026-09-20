/**
 * T8.1 档案编辑器（2026-09-20 扩展为全库编辑）—— 受控表单。
 *
 * ## 为什么重写成「草稿」模式
 *
 * 引擎（匹配 / 渲染 / 自我介绍 / 填表）消费的是**全量档案**，旧版只露
 * basics 五个字段，用户建不出自己的数据库。全库表单必然大量「打字途中」
 * 的中间态（新增条目还没填必填项），所以渲染一律读**草稿**（用户看到自己
 * 正在输的东西），而 clean / dirty / invalid 三态判定照旧走模型的
 * `editCandidate`（草稿 → schema）。关键约束没变：
 *
 * - **invalid 时保存按钮拿不到数据** —— 保存只从 dirty 发生，模型层的
 *   类型事实（invalid 分支无 archive 字段）原样成立；
 * - **clean / dirty 是与已保存值逐字节比较** —— 改回原样 = 干净；
 * - **所有结构操作走 model.ts 的不可变算术** —— 组件不自己 clone + 乱戳。
 *
 * ## 换算职责
 *
 * UI 每一格都是字符串，schema 的形状不是：双语字段空进空出
 * （`localizedFrom` 双空 = 字段不存在）、要点按行切、关键词按逗号切。
 * 「新增即 invalid」是刻意的 —— 每个分区都有必填字段，占位数据是撒谎，
 * invalid 的 issues 列表就是「还差什么」的清单。
 */

import { useMemo, useState } from 'react'

import { serializeArchive, type ArchiveV1 } from '../../../../core/src/schema/index'
import { sampleArchive } from '../../demo/sample'
import {
  addSectionEntry,
  csvFrom,
  csvOf,
  editCandidate,
  linesFrom,
  linesOf,
  localizedFrom,
  localizedOf,
  removeSectionEntry,
  saveEditor,
  setBasicsPath,
  setSectionField,
  type EditorState,
  type SectionName,
} from './model'

const STATUS_LABEL: Record<EditorState['kind'], string> = {
  clean: '已保存',
  dirty: '有未保存的修改',
  invalid: '内容有误，不能保存',
}

const STATUS_CLASS: Record<EditorState['kind'], string> = {
  clean: 'bg-emerald-100 text-emerald-800',
  dirty: 'bg-amber-100 text-amber-800',
  invalid: 'bg-red-100 text-red-800',
}

export interface ArchiveEditorProps {
  /** 已保存的档案（会话里的当前值）。 */
  saved: ArchiveV1
  /** 保存回调（App 接线到 vault.persistToVault）。 */
  onPersist: (archive: ArchiveV1) => void
}

type Entry = Record<string, unknown>

interface FieldDef {
  readonly key: string
  readonly label: string
  readonly kind: 'text' | 'localized' | 'localizedText' | 'lines' | 'csv'
}

interface SectionDef {
  readonly section: SectionName
  readonly title: string
  readonly addLabel: string
  /** 列表里一条的摘要（未填时给出诚实的「未命名」）。 */
  readonly entryTitle: (entry: Entry) => string
  readonly fields: readonly FieldDef[]
}

function zhOf(entry: Entry, key: string): string {
  const value = entry[key]
  if (value === undefined || value === null || typeof value !== 'object') return ''
  const zh = (value as Entry)['zh']
  return typeof zh === 'string' ? zh : ''
}

const SECTIONS: readonly SectionDef[] = [
  {
    section: 'education',
    title: '教育经历',
    addLabel: '新增教育经历',
    entryTitle: (e) => zhOf(e, 'institution') || '（未填学校）',
    fields: [
      { key: 'institution', label: '学校', kind: 'text' },
      { key: 'area', label: '专业', kind: 'localized' },
      { key: 'studyType', label: '学历', kind: 'localized' },
      { key: 'startDate', label: '开始（YYYY-MM）', kind: 'text' },
      { key: 'endDate', label: '结束（YYYY-MM，在读留空）', kind: 'text' },
      { key: 'gpa', label: 'GPA', kind: 'text' },
      { key: 'score', label: '成绩排名', kind: 'text' },
      { key: 'highlights', label: '在校要点（每行一条）', kind: 'lines' },
    ],
  },
  {
    section: 'work',
    title: '实习 / 工作经历',
    addLabel: '新增工作经历',
    entryTitle: (e) => zhOf(e, 'company') || '（未填公司）',
    fields: [
      { key: 'company', label: '公司', kind: 'text' },
      { key: 'position', label: '职位', kind: 'localized' },
      { key: 'startDate', label: '开始（YYYY-MM）', kind: 'text' },
      { key: 'endDate', label: '结束（YYYY-MM，至今留空）', kind: 'text' },
      { key: 'location', label: '地点', kind: 'text' },
      { key: 'summary', label: '概述', kind: 'localizedText' },
      { key: 'highlights', label: '职责与成果（每行一条）', kind: 'lines' },
    ],
  },
  {
    section: 'projects',
    title: '项目经历',
    addLabel: '新增项目',
    entryTitle: (e) => zhOf(e, 'name') || '（未命名）',
    fields: [
      { key: 'name', label: '项目名称', kind: 'localized' },
      { key: 'description', label: '项目描述', kind: 'localizedText' },
      { key: 'highlights', label: '要点（每行一条）', kind: 'lines' },
      { key: 'keywords', label: '关键词（逗号分隔）', kind: 'csv' },
      { key: 'startDate', label: '开始（YYYY-MM）', kind: 'text' },
      { key: 'endDate', label: '结束（YYYY-MM）', kind: 'text' },
      { key: 'url', label: '链接', kind: 'text' },
    ],
  },
  {
    section: 'skills',
    title: '技能',
    addLabel: '新增技能',
    entryTitle: (e) => zhOf(e, 'name') || '（未填技能）',
    fields: [
      { key: 'name', label: '技能', kind: 'localized' },
      { key: 'level', label: '熟练度', kind: 'text' },
      { key: 'keywords', label: '相关关键词（逗号分隔）', kind: 'csv' },
    ],
  },
  {
    section: 'languages',
    title: '语言',
    addLabel: '新增语言',
    entryTitle: (e) => zhOf(e, 'language') || '（未填语言）',
    fields: [
      { key: 'language', label: '语言', kind: 'localized' },
      { key: 'fluency', label: '熟练度', kind: 'text' },
      { key: 'score', label: '分数（CET / 雅思等）', kind: 'text' },
    ],
  },
  {
    section: 'certificates',
    title: '证书',
    addLabel: '新增证书',
    entryTitle: (e) => zhOf(e, 'name') || '（未填证书）',
    fields: [
      { key: 'name', label: '证书', kind: 'localized' },
      { key: 'issuer', label: '颁发机构', kind: 'text' },
      { key: 'date', label: '日期（YYYY-MM）', kind: 'text' },
      { key: 'score', label: '分数 / 等级', kind: 'text' },
    ],
  },
  {
    section: 'awards',
    title: '奖项',
    addLabel: '新增奖项',
    entryTitle: (e) => zhOf(e, 'title') || '（未填奖项）',
    fields: [
      { key: 'title', label: '奖项', kind: 'localized' },
      { key: 'date', label: '日期（YYYY-MM）', kind: 'text' },
      { key: 'awarder', label: '颁发方', kind: 'text' },
      { key: 'summary', label: '说明', kind: 'localizedText' },
    ],
  },
]

function basicsString(draft: ArchiveV1, path: string): string {
  const keys = path.split('.')
  let cursor: unknown = draft.basics
  for (const key of keys) {
    if (cursor === undefined || cursor === null || typeof cursor !== 'object') return ''
    cursor = (cursor as Entry)[key as string]
  }
  return typeof cursor === 'string' ? cursor : ''
}

function basicsNumber(draft: ArchiveV1, path: string): string {
  const value = basicsString(draft, path)
  return value === '' ? '' : value
}

export function ArchiveEditor({ saved, onPersist }: ArchiveEditorProps) {
  // 草稿是唯一渲染真相：三态判定走模型，但**显示**永远画草稿 ——
  // invalid 时用户正在输入的半成品必须可见，而不是被清成空串。
  // 基线用组件自持的 lastSaved 而不是 saved prop：持久化是异步的
  // （App 要写密文库），prop 回流前用户必须看到「已保存」，否则保存
  // 按钮点完还顶着「未保存」的狼来了。prop 真变了（外部更新 / 密文
  // 回流）时在渲染期同步 —— 逐字节相等判断保证不会循环。
  // 参数顺序：editCandidate(saved, candidate) —— 基线在前，候选在后。
  const [lastSaved, setLastSaved] = useState<ArchiveV1>(saved)
  const [draft, setDraft] = useState<ArchiveV1>(() => structuredClone(saved))
  // 同步判据是「prop 自身变了」（对照上一次收到的 prop），而不是「prop ≠
  // lastSaved」—— 保存后 lastSaved 领先 prop（密文回流是异步的），拿旧
  // prop 当真值会把刚保存的草稿整个冲掉。逐字节比较保证不循环。
  const [prevSaved, setPrevSaved] = useState<ArchiveV1>(saved)
  if (serializeArchive(saved) !== serializeArchive(prevSaved)) {
    setPrevSaved(saved)
    setLastSaved(saved)
    setDraft(structuredClone(saved))
  }
  const state: EditorState = useMemo(() => editCandidate(lastSaved, draft), [lastSaved, draft])

  function apply(next: unknown): void {
    setDraft(next as ArchiveV1)
  }

  function setBasics(path: string, value: unknown): void {
    apply(setBasicsPath(draft, path, value))
  }

  /** 双语字段的一侧输入。空侧保持原值语义由 localizedFrom 统一裁决。 */
  function setLocalized(pathBase: string, lang: 'zh' | 'en', text: string): void {
    const current = localizedOf(readPath(draft.basics, pathBase))
    apply(
      setBasicsPath(
        draft,
        pathBase,
        localizedFrom({ ...current, [lang]: text }) ?? undefined,
      ),
    )
  }

  function handleSave(): void {
    if (state.kind !== 'dirty') return
    saveEditor(state, onPersist)
    setLastSaved(state.archive)
    setDraft(structuredClone(state.archive))
  }

  return (
    <section aria-label="档案编辑器" className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">档案编辑</h2>
        <div className="flex items-center gap-2">
          {state.kind === 'clean' && (
            <button
              type="button"
              data-testid="editor-load-sample"
              title="把示例档案装进表单作为草稿起点（不会自动保存）"
              onClick={() => setDraft(structuredClone(sampleArchive))}
              className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600"
            >
              载入示例档案
            </button>
          )}
          <span
            data-testid="editor-status"
            className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[state.kind]}`}
          >
            {STATUS_LABEL[state.kind]}
          </span>
        </div>
      </header>

      <BasicsFields draft={draft} setBasics={setBasics} setLocalized={setLocalized} />

      {SECTIONS.map((def) => (
        <SectionEditor
          key={def.section}
          def={def}
          draft={draft}
          apply={apply}
        />
      ))}

      {state.kind === 'invalid' && (
        <ul data-testid="editor-issues" className="list-disc space-y-1 pl-5 text-sm text-red-700">
          {state.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        data-testid="editor-save"
        disabled={state.kind !== 'dirty'}
        className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        onClick={handleSave}
      >
        保存全部
      </button>
    </section>
  )
}

function readPath(root: unknown, path: string): unknown {
  let cursor: unknown = root
  for (const key of path.split('.')) {
    if (cursor === undefined || cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Entry)[key]
  }
  return cursor
}

function BasicsFields(props: {
  draft: ArchiveV1
  setBasics: (path: string, value: unknown) => void
  setLocalized: (pathBase: string, lang: 'zh' | 'en', text: string) => void
}) {
  const { draft, setBasics, setLocalized } = props
  return (
    <div className="space-y-3 rounded border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900">基本信息</h3>
      <div className="grid grid-cols-2 gap-3">
        <Text label="姓名" value={basicsString(draft, 'name.zh')} onChange={(v) => setLocalized('name', 'zh', v)} />
        <Text label="姓名（英文，用于英文简历）" value={basicsString(draft, 'name.en')} onChange={(v) => setLocalized('name', 'en', v)} />
        <Text label="求职意向" value={basicsString(draft, 'label.zh')} onChange={(v) => setLocalized('label', 'zh', v)} />
        <Text label="求职意向（英文）" value={basicsString(draft, 'label.en')} onChange={(v) => setLocalized('label', 'en', v)} />
        <Text label="城市" value={basicsString(draft, 'location.city')} onChange={(v) => setBasics('location.city', v.trim() === '' ? undefined : v)} />
        <Text label="手机号" value={basicsString(draft, 'contact.phone')} onChange={(v) => setBasics('contact.phone', v.trim() === '' ? undefined : v)} />
        <Text label="邮箱" value={basicsString(draft, 'contact.email')} onChange={(v) => setBasics('contact.email', v.trim() === '' ? undefined : v)} />
        <Text label="微信号" value={basicsString(draft, 'contact.wechat')} onChange={(v) => setBasics('contact.wechat', v.trim() === '' ? undefined : v)} />
        <Text label="个人主页 / GitHub" value={basicsString(draft, 'url')} onChange={(v) => setBasics('url', v.trim() === '' ? undefined : v)} />
        <Text
          label="期望薪资（数字）"
          value={basicsNumber(draft, 'desiredSalary.amount')}
          onChange={(v) => {
            const amount = v.trim() === '' ? undefined : Number(v)
            setBasics('desiredSalary.amount', amount)
          }}
        />
      </div>
      <LocalizedText
        labelBase="个人简介"
        value={localizedOf(readPath(draft.basics, 'summary'))}
        onChange={(next) => setBasics('summary', localizedFrom(next) ?? undefined)}
      />
      <details className="rounded border border-slate-100 bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">
          网申附加信息（仅用于自动填表，简历上不出现，可留空）
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Text label="性别" value={basicsString(draft, 'identity.gender')} onChange={(v) => setBasics('identity.gender', v.trim() === '' ? undefined : v)} />
          <Text label="出生日期（YYYY-MM-DD）" value={basicsString(draft, 'identity.birthDate')} onChange={(v) => setBasics('identity.birthDate', v.trim() === '' ? undefined : v)} />
          <Text label="政治面貌" value={basicsString(draft, 'identity.politicalStatus')} onChange={(v) => setBasics('identity.politicalStatus', v.trim() === '' ? undefined : v)} />
          <Text label="籍贯" value={basicsString(draft, 'identity.nativePlace')} onChange={(v) => setBasics('identity.nativePlace', v.trim() === '' ? undefined : v)} />
          <Text label="紧急联系人" value={basicsString(draft, 'emergencyContact.name')} onChange={(v) => setBasics('emergencyContact.name', v.trim() === '' ? undefined : v)} />
          <Text label="紧急联系人与你的关系" value={basicsString(draft, 'emergencyContact.relation')} onChange={(v) => setBasics('emergencyContact.relation', v.trim() === '' ? undefined : v)} />
          <Text label="紧急联系人电话" value={basicsString(draft, 'emergencyContact.phone')} onChange={(v) => setBasics('emergencyContact.phone', v.trim() === '' ? undefined : v)} />
        </div>
      </details>
    </div>
  )
}

function SectionEditor(props: {
  def: SectionDef
  draft: ArchiveV1
  apply: (next: unknown) => void
}) {
  const { def, draft, apply } = props
  const entries = (draft[def.section] as unknown as unknown[]) ?? []

  function update(index: number, field: string, value: unknown): void {
    apply(setSectionField(draft, def.section, index, field, value))
  }

  return (
    <details className="rounded border border-slate-200 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">
        {def.title}（{entries.length}）
      </summary>
      <div className="mt-3 space-y-3">
        {entries.map((raw, index) => {
          const entry = (raw ?? {}) as Entry
          return (
            <div key={index} className="rounded border border-slate-100 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">
                  #{index + 1} {def.entryTitle(entry)}
                </span>
                <button
                  type="button"
                  data-testid={`remove-${def.section}-${index}`}
                  onClick={() => apply(removeSectionEntry(draft, def.section, index))}
                  className="rounded bg-white px-2 py-0.5 text-xs text-red-600"
                >
                  删除
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {def.fields.map((field) => (
                  <SectionField
                    key={field.key}
                    def={field}
                    entry={entry}
                    onChange={(value) => update(index, field.key, value)}
                  />
                ))}
              </div>
            </div>
          )
        })}
        <button
          type="button"
          data-testid={`add-${def.section}`}
          onClick={() => apply(addSectionEntry(draft, def.section))}
          className="rounded bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700"
        >
          {def.addLabel}
        </button>
      </div>
    </details>
  )
}

function SectionField(props: {
  def: FieldDef
  entry: Entry
  onChange: (value: unknown) => void
}) {
  const { def, entry, onChange } = props
  if (def.kind === 'text') {
    const value = typeof entry[def.key] === 'string' ? (entry[def.key] as string) : ''
    return (
      <Text
        label={def.label}
        value={value}
        onChange={(v) => onChange(v.trim() === '' ? undefined : v)}
      />
    )
  }
  if (def.kind === 'localized') {
    return (
      <LocalizedPair
        labelBase={def.label}
        value={localizedOf(entry[def.key])}
        onChange={(next) => onChange(localizedFrom(next) ?? undefined)}
      />
    )
  }
  if (def.kind === 'localizedText') {
    return (
      <LocalizedText
        labelBase={def.label}
        value={localizedOf(entry[def.key])}
        onChange={(next) => onChange(localizedFrom(next) ?? undefined)}
      />
    )
  }
  if (def.kind === 'lines') {
    return (
      <Area
        label={def.label}
        value={linesOf(entry[def.key])}
        rows={4}
        onChange={(v) => onChange(linesFrom(v))}
      />
    )
  }
  // csv
  return (
    <Text
      label={def.label}
      value={csvOf(entry[def.key])}
      onChange={(v) => onChange(csvFrom(v))}
    />
  )
}

function Text(props: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{props.label}</span>
      <input
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded border border-slate-300 px-2 py-1 text-sm"
      />
    </label>
  )
}

function Area(props: {
  readonly label: string
  readonly value: string
  readonly rows: number
  readonly onChange: (value: string) => void
}) {
  return (
    <label className="col-span-2 flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{props.label}</span>
      <textarea
        rows={props.rows}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded border border-slate-300 px-2 py-1 text-sm"
      />
    </label>
  )
}

function LocalizedPair(props: {
  readonly labelBase: string
  readonly value: { readonly zh: string; readonly en: string }
  readonly onChange: (value: { zh: string; en: string }) => void
}) {
  return (
    <>
      <Text
        label={`${props.labelBase}（中）`}
        value={props.value.zh}
        onChange={(v) => props.onChange({ ...props.value, zh: v })}
      />
      <Text
        label={`${props.labelBase}（英）`}
        value={props.value.en}
        onChange={(v) => props.onChange({ ...props.value, en: v })}
      />
    </>
  )
}

function LocalizedText(props: {
  readonly labelBase: string
  readonly value: { readonly zh: string; readonly en: string }
  readonly onChange: (value: { zh: string; en: string }) => void
}) {
  return (
    <div className="col-span-2 grid grid-cols-2 gap-3">
      <Area
        label={`${props.labelBase}（中）`}
        value={props.value.zh}
        rows={3}
        onChange={(v) => props.onChange({ ...props.value, zh: v })}
      />
      <Area
        label={`${props.labelBase}（英）`}
        value={props.value.en}
        rows={3}
        onChange={(v) => props.onChange({ ...props.value, en: v })}
      />
    </div>
  )
}
