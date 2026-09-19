/**
 * T8.1 档案编辑器 —— 受控表单。
 *
 * ## 渲染层只做模型让它做的事
 *
 * 三态徽标直接映射 `EditorState.kind`：`clean` = 已保存、`dirty` =
 * 未保存、`invalid` = 有错误。因为 `invalid` 分支**没有 archive 字段**，
 * 保存按钮在错误状态下想拿数据都拿不到 —— 「不产生已保存的假象」
 * 是类型事实的渲染投影，不是按钮 disabled 的运气。
 */

import { useState } from 'react'

import type { ArchiveV1 } from '../../../../core/src/schema/index'
import { editCandidate, saveEditor, startEditor, type EditorState } from './model'

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

export function ArchiveEditor({ saved, onPersist }: ArchiveEditorProps) {
  const [state, setState] = useState<EditorState>(() => startEditor(saved))

  function candidateFrom(field: string, value: string): unknown {
    const base = state.kind === 'invalid' ? (state.raw as ArchiveV1) : state.archive
    const next = structuredClone(base) as ArchiveV1
    if (field === 'desiredSalary.amount') {
      // 数字字段：空串 = 清除，非空 = Number（「25k」会原样交给 schema 拒绝）
      const amount = value.trim() === '' ? undefined : Number(value)
      next.basics.desiredSalary =
        amount === undefined ? undefined : { ...next.basics.desiredSalary, amount }
    } else {
      const [a, b, c] = field.split('.') as ['basics', string, string | undefined]
      if (c !== undefined) {
        const parent = {
          ...((next.basics as unknown as Record<string, Record<string, unknown>>)[b] ?? {}),
        }
        parent[c] = value.trim() === '' ? undefined : value
        ;(next.basics as Record<string, unknown>)[b] = parent
      } else {
        ;(next.basics as Record<string, unknown>)[a === 'basics' ? b : a] =
          value.trim() === '' ? undefined : value
      }
    }
    return next
  }

  return (
    <section aria-label="档案编辑器" className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">档案编辑</h2>
        <span
          data-testid="editor-status"
          className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[state.kind]}`}
        >
          {STATUS_LABEL[state.kind]}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="姓名"
          value={state.kind === 'invalid' ? '' : (state.archive.basics.name?.zh ?? '')}
          onChange={(v) => setState((s) => editCandidate(s, saved, candidateFrom('basics.name.zh', v)))}
        />
        <Field
          label="城市"
          value={state.kind === 'invalid' ? '' : (state.archive.basics.location?.city ?? '')}
          onChange={(v) =>
            setState((s) => editCandidate(s, saved, candidateFrom('basics.location.city', v)))
          }
        />
        <Field
          label="手机号"
          value={state.kind === 'invalid' ? '' : (state.archive.basics.contact.phone ?? '')}
          onChange={(v) =>
            setState((s) => editCandidate(s, saved, candidateFrom('basics.contact.phone', v)))
          }
        />
        <Field
          label="邮箱"
          value={state.kind === 'invalid' ? '' : (state.archive.basics.contact.email ?? '')}
          onChange={(v) =>
            setState((s) => editCandidate(s, saved, candidateFrom('basics.contact.email', v)))
          }
        />
        <Field
          label="期望薪资（数字）"
          value={
            state.kind === 'invalid'
              ? ''
              : state.archive.basics.desiredSalary?.amount === undefined
                ? ''
                : String(state.archive.basics.desiredSalary.amount)
          }
          onChange={(v) =>
            setState((s) => editCandidate(s, saved, candidateFrom('desiredSalary.amount', v)))
          }
        />
      </div>

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
        onClick={() => {
          if (state.kind === 'dirty') setState(saveEditor(state, onPersist))
        }}
      >
        保存
      </button>
    </section>
  )
}

function Field(props: {
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
