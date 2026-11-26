// @vitest-environment node

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { vueOfficePdfSource } from '../vite.config.js'

const officialWorkerPath = createRequire(import.meta.url).resolve(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
)

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
    const nodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await build({
        configFile: resolve(process.cwd(), 'vite.config.js'),
        logLevel: 'silent'
      })
      await build({
        configFile: resolve(process.cwd(), 'vite.config.js'),
        logLevel: 'silent',
        mode: 'compat'
      })
    } finally {
      process.env.NODE_ENV = nodeEnv
    }
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
    expect(await readFile(resolve(libDirectory, 'index.d.ts'), 'utf8')).toBe(
      await readFile(resolve(process.cwd(), 'index.d.ts'), 'utf8')
    )
    expect(relativeFiles.some((file) => /^chunks\/pdf-.*\.js$/.test(file))).toBe(
      true
    )
    expect(relativeFiles.filter((file) => file.includes('pdf.worker'))).toEqual([
      'compat/assets/pdf.worker.min.js'
    ])
    const worker = await readFile(resolve(libDirectory, 'compat/assets/pdf.worker.min.js'), 'utf8')
    const officialWorker = await readFile(officialWorkerPath, 'utf8')
    expect(worker === officialWorker.replace('globalThis.pdfjsWorker={WorkerMessageHandler};', '')).toBe(true)
    expect(worker).not.toContain('pdfjsWorker')
    const pdfChunks = await Promise.all(
      files
        .filter((file) => /\/chunks\/pdf-.*\.js$/.test(file))
        .map((file) => readFile(file, 'utf8'))
    )
    expect(pdfChunks).toHaveLength(2)
    expect(pdfChunks.join('\n')).not.toContain('pdfjsWorker')
    expect(javascript).not.toContain('globalThis.pdfjsLib')
    expect(javascript).not.toContain('_pdfjsTestingUtils')
    expect(javascript).not.toContain('pdfjs-dist@3.1.81')
    expect(javascript).not.toContain('unpkg.com')
    expect(javascript).not.toContain('lodash')
    expect(javascript).not.toContain('data:text/javascript')
    expect(javascript).not.toContain(
      'pdfjs-dist/legacy/build/pdf.mjs'
    )
    expect(relativeFiles).not.toContain('assets/cmaps/Adobe-CNS1-0.bcmap')
    expect(relativeFiles).not.toContain('assets/wasm/openjpeg.wasm')
  })

  it('输出 Chromium 102 compat 入口、worker 和自包含资源', async () => {
    const files = await listFiles(libDirectory)
    const relativeFiles = files.map((file) =>
      file.slice(libDirectory.length + 1)
    )
    const compatJavascript = (
      await Promise.all(
        files
          .filter(
            (file) =>
              file.startsWith(resolve(libDirectory, 'compat')) &&
              file.endsWith('.js')
          )
          .map((file) => readFile(file, 'utf8'))
      )
    ).join('\n')
    const compatEntry = await readFile(
      resolve(libDirectory, 'compat/index.js'),
      'utf8'
    )

    expect(relativeFiles).toContain('compat/index.js')
    expect(relativeFiles).toContain(
      'compat/assets/cmaps/Adobe-CNS1-0.bcmap'
    )
    expect(relativeFiles).toContain(
      'compat/assets/standard_fonts/FoxitFixed.pfb'
    )
    expect(relativeFiles).toContain('compat/assets/wasm/openjpeg.wasm')
    expect(relativeFiles).toContain('compat/index.d.ts')
    expect(relativeFiles).toContain('compat/assets/standard_fonts/LICENSE_FOXIT')
    expect(relativeFiles.filter((file) => file.startsWith('compat/assets/wasm/')).sort()).toEqual([
      'compat/assets/wasm/LICENSE_JBIG2',
      'compat/assets/wasm/LICENSE_OPENJPEG',
      'compat/assets/wasm/LICENSE_PDFJS_JBIG2',
      'compat/assets/wasm/LICENSE_PDFJS_OPENJPEG',
      'compat/assets/wasm/jbig2.wasm',
      'compat/assets/wasm/openjpeg.wasm'
    ])
    expect(compatEntry).not.toContain('LICENSE')
    expect(compatJavascript).toContain('5.7.284')
    expect(compatJavascript).not.toContain('globalThis.pdfjsLib')
    expect(compatJavascript).not.toContain('/Users/')
    expect(compatEntry).not.toContain('.workerPort')
    expect(compatEntry).toContain(
      'new URL("assets/pdf.worker.min.js", import.meta.url).href'
    )
  })

  it('宿主 Vite 应用通过源码插件解析运行时虚拟模块，输出隔离的 worker 与资源', async () => {
    const outDir = await mkdtemp(resolve(tmpdir(), 'vue-office-pdf-source-'))
    try {
      await build({
        configFile: false,
        logLevel: 'silent',
        plugins: [vue(), vueOfficePdfSource()],
        build: {
          outDir,
          rollupOptions: { input: resolve(process.cwd(), 'index.js') }
        }
      })
      const files = await listFiles(outDir)
      const worker = await readFile(files.find((file) => /pdf\.worker\.min-.*\.js$/.test(file)), 'utf8')
      const javascript = (
        await Promise.all(files.filter((file) => file.endsWith('.js')).map((file) => readFile(file, 'utf8')))
      ).join('\n')
      expect(worker).not.toContain('pdfjsWorker')
      expect(worker).toContain('export{WorkerMessageHandler}')
      expect(javascript).not.toContain('pdfjsWorker')
      expect(javascript).not.toContain('globalThis.pdfjsLib')
      expect(files.some((file) => file.endsWith('.bcmap'))).toBe(true)
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  })
})
