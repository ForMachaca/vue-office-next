import { afterEach, describe, expect, it, vi } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({
  globalWorkerOptions: {}
}))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: runtimeMocks.globalWorkerOptions,
  getDocument: vi.fn(),
  version: '5.7.284'
}))

vi.mock('virtual:pdfjs-worker-url', () => ({
  default: '/assets/pdf.worker.min.mjs'
}))

vi.mock('virtual:pdfjs-resources', () => ({
  default: {
    cMapUrl: {
      'Adobe-CNS1-0.bcmap': '/assets/cmaps/Adobe-CNS1-0.bcmap'
    },
    standardFontDataUrl: {
      'FoxitFixed.pfb': '/assets/standard_fonts/FoxitFixed.pfb'
    },
    wasmUrl: {
      'openjpeg.wasm': '/assets/wasm/openjpeg.wasm'
    }
  }
}))

import {
  CompatBinaryDataFactory,
  createDocumentOptions,
  loadPdfjsLib
} from '../src/runtime/compat.js'

describe('PDF.js compat runtime', () => {
  afterEach(() => {
    Reflect.deleteProperty(runtimeMocks.globalWorkerOptions, 'workerSrc')
    vi.unstubAllGlobals()
  })

  it('复用 PDF.js runtime，并由 PDF.js 按文档加载随包 Worker', async () => {
    const first = await loadPdfjsLib()
    const second = await loadPdfjsLib()

    expect(first).toBe(second)
    expect(runtimeMocks.globalWorkerOptions.workerSrc).toBe('/assets/pdf.worker.min.mjs')
    expect(runtimeMocks.globalWorkerOptions.workerPort).toBeUndefined()
  })

  it('覆盖 compat 资源选项且保留其他调用参数', () => {
    const options = createDocumentOptions({
      url: '/files/report.pdf',
      wasmUrl: '/host/pdfjs/wasm/',
      width: 800
    })

    expect(options).toEqual(
      expect.objectContaining({
        url: '/files/report.pdf',
        width: 800,
        cMapPacked: true,
        cMapUrl: null,
        standardFontDataUrl: null,
        wasmUrl: null,
        useWorkerFetch: false,
        BinaryDataFactory: CompatBinaryDataFactory
      })
    )
  })

  it('按 kind 和 filename 获取随包资源字节，未知资源明确失败', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(Uint8Array.from([1, 2, 3]).buffer)
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const factory = new CompatBinaryDataFactory()

    await expect(
      factory.fetch({
        kind: 'cMapUrl',
        filename: 'Adobe-CNS1-0.bcmap'
      })
    ).resolves.toEqual(Uint8Array.from([1, 2, 3]))
    expect(fetchMock).toHaveBeenCalledWith(
      '/assets/cmaps/Adobe-CNS1-0.bcmap'
    )
    await expect(
      factory.fetch({ kind: 'wasmUrl', filename: 'missing.wasm' })
    ).rejects.toThrow('Unknown PDF.js compat resource: wasmUrl/missing.wasm')
  })
})
