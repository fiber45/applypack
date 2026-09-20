import { useMemo, useState } from 'react'

import { buildReportView, matchArchive } from '../../core/src/match/index'
import { buildDeliveryPackage, type PackageView } from '../../core/src/render/index'
import { SAMPLE_LIMIT, SAMPLE_NOW, sampleArchive, sampleJd } from './demo/sample'
import { MatchReport } from './features/match-report/MatchReport'
import { ArchiveEditor } from './features/archive-editor/ArchiveEditor'
import { buildPreviewModel } from './features/preview/model'
import { deliverAll, type FileSink } from './features/preview/deliver'
import { renderViewToBlob } from './features/delivery/render-browser'
import {
  createSession,
  exportVaultText,
  importVaultText,
  lockSession,
  openSession,
  persistToVault,
  type VaultSessionState,
} from './features/vault-session/model'

type TabName = 'archive' | 'preview' | 'deliver'

const TABS: ReadonlyArray<{ readonly name: TabName; readonly label: string }> = [
  { name: 'archive', label: '档案' },
  { name: 'preview', label: '预览' },
  { name: 'deliver', label: '导出' },
]

function downloadFile(fileName: string, content: string | Blob): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Demo 外壳 —— M8 起是三块真东西：档案（编辑 + 密文会话）、预览、导出。
 *
 * ## 数据流是单向的：会话档案 → 编辑器 → 保存回会话 → 预览/导出
 *
 * 预览与导出**只读会话里的已保存档案**（`session.kind === 'unlocked'
 * 才有 archive`）：编辑器里改了但没保存，预览不跟着变 —— 「未保存
 * 的东西不出现在下游」与 T5/T7 的凭据语义一脉相承。
 *
 * ## 匹配报告留在首屏
 *
 * sample 档案跑的匹配报告（T2.3 的第一块真东西）仍在 —— 它是引擎的
 * 现场演示；M8 的三块从 sample 档案出发把它变成能自助用的应用。
 */
export function App() {
  const [tab, setTab] = useState<TabName>('archive')
  const [session, setSession] = useState<VaultSessionState>({ kind: 'no-vault' })
  const [passphrase, setPassphrase] = useState('')
  const [vaultText, setVaultText] = useState('')
  // 会话级操作失败的可见状态。2026-09-20 事故的直接产物：onClick 里
  // `void promise.then(...)` 没有 catch，CSP 拒绝 WASM 后拒绝被吞，
  // 用户看到的「点了没反应」。失败必须画出来 —— 与 openSession 把
  // unlock-failed 当作一种画面状态是同一条原则，只是来源更广。
  const [sessionError, setSessionError] = useState<string | null>(null)
  // 「复制密文信封」的已复制反馈 —— 扩展粘贴信封流程的第一步（T9.2）。
  const [envelopeCopied, setEnvelopeCopied] = useState(false)

  const report = useMemo(() => {
    // 匹配报告吃**当前会话的档案**（解锁后就是你自己的数据库）；
    // 未建库时用示例档案做引擎演示。同一份 JD，报告随档案切换。
    const input = session.kind === 'unlocked' ? session.archive : sampleArchive
    return buildReportView(matchArchive(input, sampleJd, { now: SAMPLE_NOW, limit: SAMPLE_LIMIT }))
  }, [session])

  const archive = session.kind === 'unlocked' ? session.archive : null

  async function handlePersist(next: Parameters<typeof persistToVault>[1]): Promise<void> {
    if (session.kind === 'unlocked') {
      setSession(await persistToVault(session, next))
    }
  }

  /** 创建失败是可见状态：拒绝被接住并画出，绝不静默（见 sessionError 注释）。 */
  async function handleCreate(): Promise<void> {
    setSessionError(null)
    try {
      // 新库从**空档案**起步：这是用户自己的数据库，预置示例数据是越俎代庖
      // （示例改为编辑器里的「载入示例档案」按钮，且只是草稿，不自动保存）。
      setSession(await createSession(passphrase))
    } catch (cause) {
      setSessionError(`创建密文库失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  /** 导入坏文件会同步抛错 —— 同样画出来，而不是让 React 事件处理器崩掉。 */
  function handleImport(): void {
    setSessionError(null)
    try {
      setSession(importVaultText(vaultText))
    } catch (cause) {
      setSessionError(`导入失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  /**
   * T9.2 —— 扩展的密文副本通道是「粘贴信封」：Web 端负责把信封送进剪贴板。
   * 剪贴板写入失败（权限 / 非安全上下文）画成可见错误 —— 复制失败却提示
   * 成功，用户会在网申页粘出一堆空气。
   */
  async function handleCopyEnvelope(): Promise<void> {
    setEnvelopeCopied(false)
    setSessionError(null)
    try {
      if (session.kind === 'no-vault') return
      await navigator.clipboard.writeText(exportVaultText(session))
      setEnvelopeCopied(true)
    } catch (cause) {
      setSessionError(`复制信封失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  function handleDeliver(): void {
    if (archive === null) return
    const pkg = buildDeliveryPackage(archive)
    const renderPdf = async (html: string): Promise<Blob> => {
      const view: PackageView = pkg.views.cn.html === html ? pkg.views.cn : pkg.views.en
      return renderViewToBlob(view)
    }
    const sink: FileSink = (name, content) => downloadFile(name, content)
    void deliverAll(archive, sink, renderPdf)
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-lg font-semibold text-slate-900">applypack · 投递包</h1>
        <p className="mt-1 text-sm text-slate-500">
          全链路跑在浏览器里，全程零网络请求。样本档案与 JD 均为虚构数据。
        </p>
      </header>

      <nav aria-label="功能导航" className="mb-6 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.name}
            type="button"
            data-testid={`tab-${t.name}`}
            aria-pressed={tab === t.name}
            onClick={() => setTab(t.name)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              tab === t.name ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'archive' && (
        <section className="space-y-6">
          {sessionError !== null && (
            <p
              role="alert"
              data-testid="vault-error"
              className="rounded bg-red-50 p-3 text-sm text-red-700"
            >
              {sessionError}
            </p>
          )}
          {session.kind === 'no-vault' && (
            <div className="rounded border border-slate-200 p-4">
              <h2 className="text-base font-semibold text-slate-900">创建密文库</h2>
              <p className="mt-1 text-sm text-slate-500">
                口令用于加密本机档案。**忘记口令数据就没了** —— 没有恢复后门。
                已有备份？把 .vault 文本粘进下面导入。
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  type="password"
                  aria-label="新库口令"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  data-testid="vault-create"
                  disabled={passphrase.length === 0}
                  onClick={() => {
                    void handleCreate()
                  }}
                  className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  创建并解锁
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                <textarea
                  aria-label="导入 .vault 文本"
                  onChange={(e) => setVaultText(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-slate-200 p-2 font-mono text-xs"
                  placeholder='{"format":"applypack-vault",...}'
                />
                <button
                  type="button"
                  data-testid="vault-import"
                  onClick={handleImport}
                  className="rounded bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700"
                >
                  导入
                </button>
              </div>
            </div>
          )}

          {session.kind === 'locked' && (
            <div className="rounded border border-slate-200 p-4">
              <h2 className="text-base font-semibold text-slate-900">解锁密文库</h2>
              <div className="mt-3 flex gap-2">
                <input
                  type="password"
                  aria-label="解锁口令"
                  onChange={(e) => setPassphrase(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  data-testid="vault-open"
                  onClick={() => {
                    void openSession(session.file, passphrase).then(setSession)
                  }}
                  className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
                >
                  解锁
                </button>
              </div>
            </div>
          )}

          {session.kind === 'unlock-failed' && (
            <p className="rounded bg-red-50 p-3 text-sm text-red-700">
              口令不对，或文件已损坏。**档案不会显示** —— 请重试或导入有效的 .vault 文件。
            </p>
          )}

          {archive !== null && (
            <>
              <ArchiveEditor saved={archive} onPersist={(a) => void handlePersist(a)} />
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="vault-lock"
                  onClick={() => {
                    if (session.kind === 'unlocked') setSession(lockSession(session))
                  }}
                  className="rounded bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700"
                >
                  锁定
                </button>
                <button
                  type="button"
                  data-testid="vault-export"
                  onClick={() => {
                    if (session.kind !== 'no-vault') setVaultText(exportVaultText(session))
                  }}
                  className="rounded bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700"
                >
                  导出 .vault 文本
                </button>
                <button
                  type="button"
                  data-testid="vault-copy-envelope"
                  onClick={() => {
                    void handleCopyEnvelope()
                  }}
                  className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
                >
                  复制密文信封
                </button>
                {envelopeCopied && (
                  <span data-testid="vault-copy-done" className="self-center text-sm text-green-700">
                    已复制 —— 到网申页面粘贴进扩展面板
                  </span>
                )}
              </div>
              {vaultText !== '' && (
                <textarea
                  aria-label="密文内容"
                  readOnly
                  value={vaultText}
                  rows={4}
                  className="w-full rounded border border-slate-200 p-2 font-mono text-xs"
                />
              )}
            </>
          )}

          <MatchReport view={report} />
        </section>
      )}

      {tab === 'preview' && (
        <section className="space-y-4" aria-label="生成预览">
          {archive === null ? (
            <p className="text-sm text-slate-500">先在「档案」创建 / 解锁密文库。</p>
          ) : (
            <PreviewPanes archive={archive} />
          )}
        </section>
      )}

      {tab === 'deliver' && (
        <section className="space-y-4" aria-label="导出交付">
          {archive === null ? (
            <p className="text-sm text-slate-500">先在「档案」创建 / 解锁密文库。</p>
          ) : (
            <div>
              <p className="text-sm text-slate-500">
                导出两份 PDF（中 / 英）与两份自述文本，文件名由引擎统一产出。
              </p>
              <button
                type="button"
                data-testid="deliver-download"
                onClick={handleDeliver}
                className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
              >
                下载交付文件
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  )
}

function PreviewPanes({ archive }: { archive: NonNullable<VaultSessionState & { kind: 'unlocked' }>['archive'] }) {
  const preview = useMemo(() => buildPreviewModel(archive), [archive])
  return (
    <>
      {preview.intros.map((intro) => (
        <blockquote
          key={intro.target.name}
          data-testid={`intro-${intro.target.lang}`}
          className="rounded bg-slate-50 p-3 text-sm text-slate-700"
        >
          {intro.text}
        </blockquote>
      ))}
      <details open>
        <summary className="cursor-pointer text-sm font-medium text-slate-700">中文简历</summary>
        <iframe
          title="中文简历预览"
          srcDoc={preview.cnHtml}
          className="mt-2 h-96 w-full rounded border border-slate-200"
        />
      </details>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-slate-700">英文简历</summary>
        <iframe
          title="英文简历预览"
          srcDoc={preview.enHtml}
          className="mt-2 h-96 w-full rounded border border-slate-200"
        />
      </details>
    </>
  )
}
