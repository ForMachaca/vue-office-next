// @vitest-environment node

import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const filePath = resolve(directory, entry.name)
      return entry.isDirectory() ? listFiles(filePath) : filePath
    })
  )
  return files.flat()
}

describe('VueOfficePdf 构建隔离', () => {
  const libDirectory = resolve(process.cwd(), 'lib')

  beforeAll(async () => {
    await build({
      configFile: resolve(process.cwd(), 'vite.config.js'),
      logLevel: 'silent'
    })
  })

  it('输出私有 PDF chunk 和独立 worker，且不读写 pdfjsLib 全局', async () => {
    const files = await listFiles(libDirectory)
    const relativeFiles = files.map((file) =>
      file.slice(libDirectory.length + 1)
    )
    const jsFiles = files.filter((file) => file.endsWith('.js'))
    const javascript = (
      await Promise.all(jsFiles.map((file) => readFile(file, 'utf8')))
    ).join('\n')

    expect(relativeFiles).toContain('index.js')
    expect(relativeFiles.some((file) => /^chunks\/pdf-.*\.js$/.test(file))).toBe(
      true
    )
    expect(
      relativeFiles.some((file) => /pdf\.worker\.min-.*\.mjs$/.test(file))
    ).toBe(true)
    expect(javascript).not.toContain('globalThis.pdfjsLib')
    expect(javascript).not.toContain('_pdfjsTestingUtils')
    expect(javascript).not.toContain('pdfjs-dist@3.1.81')
    expect(javascript).not.toContain('data:text/javascript')
    expect(javascript).not.toContain(
      'pdfjs-dist/legacy/build/pdf.mjs'
    )
  })
})
