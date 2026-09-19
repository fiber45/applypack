#!/usr/bin/env node
/**
 * 拉取「交付 PDF」需要的字体，并逐个校验 SHA-256。
 *
 * ## 为什么是「拉取 + 钉哈希」，而不是把字体提交进仓库
 *
 * 交付 PDF 必须内嵌字体，否则中文会变成方框 —— 而 PDF 不能依赖阅读器
 * 恰好装了某个字体，这一条没有妥协余地。但把 21 MB 的 TTF 提交进 git 有三个
 * 具体代价：仓库克隆变慢、每次字体升级都在历史里留一份完整副本、
 * 代码评审里出现无法阅读的二进制 diff。
 *
 * 于是改成：**仓库里只有这个脚本和两个哈希**，字体在 `pretest` / `prebuild`
 * 时按需拉取。哈希写死在下面，所以「拉到的字节」是可复现的 ——
 * 换掉上游文件而不改这里，构建会红，而不是安静地换一份字体。
 *
 * ## 字体与授权
 *
 * Noto Sans SC，SIL Open Font License 1.1（可自由使用与再分发，包括内嵌进
 * PDF）。来源是 npm 上的 `@expo-google-fonts/noto-sans-sc`，它是 Google Fonts
 * 那份 Noto Sans SC 的静态字重打包 —— 用它的唯一理由是它提供**静态 TTF**：
 * Google Fonts 官方仓库现在只提供可变字体（`NotoSansSC[wght].ttf`），
 * 而 fontkit（react-pdf 的字体引擎）对可变字体的字重选取没有稳定行为。
 *
 * 为什么是 400 + 600 两个字重：`RESUME_STYLES` 里 `h1` 与 `.entry h3` 用的是
 * `font-weight: 600`，正文是 400。PDF 不能合成伪粗体，所以两个字重都得有文件。
 * 代价是 21 MB —— **这笔账记在 TASKS.md 的 T4a 里**，不在代码里悄悄消化。
 *
 * 用法：`node scripts/fetch-fonts.mjs [--force] [--check]`
 * `--check` 只校验不下载，供 CI 在没有网的时候确认字体已就位。
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, '..', 'public', 'fonts')

const SOURCE = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-sc@0.4.3'

/**
 * 文件名 → 上游路径 + 期望哈希。
 *
 * 文件名**由我们决定**（`NotoSansSC-Regular.ttf`），不沿用上游的
 * `400Regular/NotoSansSC_400Regular.ttf`：上游路径同时编码了字重与目录层级，
 * 一旦将来上游改了层级结构，引用它的每一处都得跟着改。这里做一次映射，
 * 把「上游怎么摆」收在这一个表里。
 */
const FONTS = [
  {
    file: 'NotoSansSC-Regular.ttf',
    url: `${SOURCE}/400Regular/NotoSansSC_400Regular.ttf`,
    sha256: 'd45f67f0a7c0ca3f256950777ce6a61cc7ce5f9696d02900cbbaac25f8aa7d16',
    bytes: 10559284,
    weight: 400,
  },
  {
    file: 'NotoSansSC-SemiBold.ttf',
    url: `${SOURCE}/600SemiBold/NotoSansSC_600SemiBold.ttf`,
    sha256: 'b5eb7510dff58e0626c72c0861d83a3ed2be1d03047cf90a623682b8667bc5ff',
    bytes: 10548948,
    weight: 600,
  },
]

export const FONT_FILES = FONTS.map((font) => font.file)

/** 许可与来源声明。**必须与字体一起被部署** —— OFL 要求分发时带上声明。 */
const NOTICE = `本目录下的字体文件由 packages/web/scripts/fetch-fonts.mjs 拉取，不入版本库。

字体：Noto Sans SC（Regular 400 / SemiBold 600）
版权：Copyright 2014-2024 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.
      基于 Source Han Sans，由 Google 改名为 Noto Sans SC。
许可：SIL Open Font License 1.1 — https://openfontlicense.org/
来源：${SOURCE}
用途：简历 PDF 的内嵌字体。OFL 允许内嵌进文档与再分发。

许可证全文见 https://openfontlicense.org/open-font-license-official-text/
（本项目不复制正文，只给出来源与许可标识；若你要再分发这些字体本身，
请连同许可证全文一起分发。）
`

async function sha256Of(path) {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载失败 ${url}：HTTP ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function ensureFont(font, { force, checkOnly }) {
  const path = join(OUT_DIR, font.file)

  if (!force && existsSync(path)) {
    const actual = await sha256Of(path)
    if (actual === font.sha256) return { file: font.file, status: 'ok' }
    if (checkOnly) {
      throw new Error(
        `${font.file} 的 SHA-256 与钉住的值不符。\n  期望 ${font.sha256}\n  实际 ${actual}\n` +
          '先删掉这个文件再跑一次（不要直接改哈希 —— 改哈希等于把「可复现」这条丢掉）。',
      )
    }
  } else if (checkOnly) {
    throw new Error(`${font.file} 不存在，而 --check 不允许下载。先跑一次不带 --check 的。`)
  }

  const bytes = await download(font.url)
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== font.sha256) {
    throw new Error(
      `${font.file} 下载后的 SHA-256 与钉住的值不符。\n  期望 ${font.sha256}\n  实际 ${actual}\n` +
        '上游换了文件。**先确认这是不是有意的**，再决定改哈希 —— ' +
        '字体换了会让已经发出去的 PDF 与现在生成的 PDF 不一致。',
    )
  }
  if (bytes.length !== font.bytes) {
    throw new Error(`${font.file} 字节数不符：期望 ${font.bytes}，实际 ${bytes.length}`)
  }

  await writeFile(path, bytes)
  return { file: font.file, status: force ? 'refetched' : 'fetched' }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const force = args.has('--force')
  const checkOnly = args.has('--check')

  await mkdir(OUT_DIR, { recursive: true })

  const results = []
  for (const font of FONTS) {
    results.push(await ensureFont(font, { force, checkOnly }))
  }

  await writeFile(join(OUT_DIR, 'NOTICE.txt'), NOTICE)

  const summary = results.map((item) => `${item.file}=${item.status}`).join(' ')
  console.log(`[fetch-fonts] ${summary}`)
}

main().catch((error) => {
  console.error(`[fetch-fonts] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
