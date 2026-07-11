import { afterEach, describe, expect, it, vi } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({
  globalWorkerOptions: {},
  workerInstances: []
}))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: runtimeMocks.globalWorkerOptions,
  getDocument: vi.fn(),
  version: '5.7.284'
}))

vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker', () => ({
  default: class MockPdfWorker {
    constructor(options) {
      this.options = options
      runtimeMocks.workerInstances.push(this)
    }
  }
}))

vi.mock('virtual:pdfjs-compat-resources', () => ({
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
    runtimeMocks.workerInstances.length = 0
    Reflect.deleteProperty(runtimeMocks.globalWorkerOptions, 'workerPort')
    vi.unstubAllGlobals()
  })

  it('使用独立 workerPort 并复用同一 PDF.js runtime', async () => {
    const first = await loadPdfjsLib()
    const second = await loadPdfjsLib()

    expect(first).toBe(second)
    expect(runtimeMocks.workerInstances).toHaveLength(1)
    expect(runtimeMocks.globalWorkerOptions.workerPort).toBe(
      runtimeMocks.workerInstances[0]
    )
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
        cMapUrl: 'compat://cmaps/',
        standardFontDataUrl: 'compat://standard-fonts/',
        wasmUrl: 'compat://wasm/',
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
