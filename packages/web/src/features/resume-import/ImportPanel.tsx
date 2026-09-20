/**
 * T9.1c PDF 导入面板。
 *
 * ## 状态机：idle → parsing → ready | failed
 *
 * - **ready 只在有可填内容时出现**：解析结果全空（连联系方式都没有）
 *   时进入 failed，错误信息里交代 leftover 有多少 —— 「识别不了」本身
 *   就是必须可见的结果，静默返回 idle 等于骗用户「成功」；
 * - **预览先于人眼**：填入之前把识别计数和 leftover 全部亮出来 ——
 *   解析是启发式，用户看到「实习 2、教育 1、看不懂的行 N」才谈得上确认；
 * - **填入 ≠ 保存**：onApply 只改编辑器草稿，落库仍要走「保存全部」——
 *   编辑器的三态闸门（invalid 不能保存）在人眼之外再兜一层。
 */

import { useState } from 'react'

import { parseResumeText, type ParsedResume } from './parse'
import { readPdfFile } from './extract-file'

type ImportStatus = 'idle' | 'parsing' | 'ready' | 'failed'

export function ImportPanel(props: { onApply: (parsed: ParsedResume) => void }) {
  const { onApply } = props
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [parsed, setParsed] = useState<ParsedResume | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  async function handleFile(file: File): Promise<void> {
    setStatus('parsing')
    setParsed(undefined)
    setError(undefined)
    try {
      const lines = await readPdfFile(file)
      const result = parseResumeText(lines.join('\n'))
      const total =
        result.work.length +
        result.education.length +
        result.projects.length +
        result.skills.length +
        result.languages.length +
        result.certificates.length +
        result.awards.length
      if (total === 0 && result.name === undefined && result.email === undefined && result.phone === undefined) {
        setStatus('failed')
        setError(
          `没能从这份 PDF 里识别出任何结构化内容（扫描件/图片型 PDF 不在识别范围）。有 ${result.leftover.length} 行原文没能归类，可对照它们手动填写。`,
        )
        return
      }
      setParsed(result)
      setStatus('ready')
    } catch (cause) {
      setStatus('failed')
      setError(`PDF 解析失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  return (
    <details className="rounded border border-slate-200 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">
        从 PDF 导入现有简历
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-slate-500">
          解析在本机完成，PDF 不会上传到任何地方。识别结果只进编辑器草稿，确认无误并点「保存全部」后才会入库。
        </p>
        <input
          type="file"
          accept="application/pdf,.pdf"
          data-testid="import-pdf-input"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file !== undefined) void handleFile(file)
          }}
          className="block text-sm text-slate-600"
        />
        {status === 'parsing' && <p className="text-sm text-slate-600">解析中……</p>}
        {error !== undefined && (
          <p role="alert" data-testid="import-error" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {status === 'ready' && parsed !== undefined && (
          <div data-testid="import-preview" className="space-y-2 rounded bg-slate-50 p-3">
            <p className="text-sm text-slate-700">
              识别结果：实习 / 工作经历：{parsed.work.length}、教育经历：{parsed.education.length}
              、项目：{parsed.projects.length}、技能：{parsed.skills.length}、语言：
              {parsed.languages.length}、证书：{parsed.certificates.length}、奖项：
              {parsed.awards.length}
              {parsed.name !== undefined && '、姓名'}
              {parsed.email !== undefined && '、邮箱'}
              {parsed.phone !== undefined && '、电话'}
              {parsed.summary !== undefined && '、自我评价'}
            </p>
            {parsed.leftover.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs text-slate-500">
                  未识别的行（{parsed.leftover.length}），请对照手动填写
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-500">
                  {parsed.leftover.join('\n')}
                </pre>
              </details>
            )}
            <button
              type="button"
              data-testid="import-apply"
              onClick={() => onApply(parsed)}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              填入编辑器（只补空，不覆盖已有内容）
            </button>
          </div>
        )}
      </div>
    </details>
  )
}
