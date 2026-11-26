import { afterEach, describe, expect, it, vi } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({
  globalWorkerOptions: {},
  shouldFailLoad: false
}))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: runtimeMocks.globalWorkerOptions,
  getDocument: vi.fn(),
  version: '5.7.284'
}))

vi.mock('virtual:pdfjs-worker-url', () => ({
  get default() {
    if (runtimeMocks.shouldFailLoad) {
      throw new Error('worker chunk failed')
    }
    return '/assets/pdf.worker.min.mjs'
  }
}))

vi.mock('virtual:pdfjs-resources', () => ({
  default: {
    cMapUrl: {
      'Adobe-CNS1-0.bcmap': '/compat/assets/cmaps/Adobe-CNS1-0.bcmap'
    },
    standardFontDataUrl: {
      'FoxitFixed.pfb': '/compat/assets/standard_fonts/FoxitFixed.pfb'
    },
    wasmUrl: {
      'openjpeg.wasm': '/compat/assets/wasm/openjpeg.wasm'
    }
  }
}))

import {
  ModernBinaryDataFactory,
  createDocumentOptions,
  loadPdfjsLib
} from '../src/runtime/modern.js'

describe('PDF.js modern runtime', () => {
  afterEach(() => {
    runtimeMocks.shouldFailLoad = false
    Reflect.deleteProperty(runtimeMocks.globalWorkerOptions, 'workerSrc')
    vi.unstubAllGlobals()
  })

  it('缺少资源目录时由主线程工厂加载随包资源，资源全部显式或自带工厂时原样透传', () => {
    const fullyCustomOptions = {
      url: '/files/report.pdf',
      cMapUrl: '/host/cmaps/',
      standardFontDataUrl: '/host/fonts/',
      wasmUrl: '/host/wasm/',
      useWorkerFetch: true
    }
    const factoryOptions = {
      url: '/files/report.pdf',
      useWorkerFetch: true,
      BinaryDataFactory: class CustomBinaryDataFactory {}
    }

    expect(createDocumentOptions({ url: '/files/report.pdf' })).toEqual({
      url: '/files/report.pdf',
      useWorkerFetch: false,
      BinaryDataFactory: ModernBinaryDataFactory
    })
    expect(createDocumentOptions({
      url: '/files/report.pdf',
      wasmUrl: '/host/wasm/',
      useWorkerFetch: true
    })).toEqual({
      url: '/files/report.pdf',
      wasmUrl: '/host/wasm/',
      useWorkerFetch: false,
      BinaryDataFactory: ModernBinaryDataFactory
    })
    expect(createDocumentOptions(fullyCustomOptions)).toBe(fullyCustomOptions)
    expect(createDocumentOptions(factoryOptions)).toBe(factoryOptions)
  })

  it('ModernBinaryDataFactory 对内置与自定义路径分别按需拉取字节', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(Uint8Array.from([4, 5, 6]).buffer)
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const factory = new ModernBinaryDataFactory({
      cMapUrl: null,
      standardFontDataUrl: null,
      wasmUrl: '/host/wasm/'
    })

    await expect(
      factory.fetch({ kind: 'cMapUrl', filename: 'Adobe-CNS1-0.bcmap' })
    ).resolves.toEqual(Uint8Array.from([4, 5, 6]))
    expect(fetchMock).toHaveBeenCalledWith('/compat/assets/cmaps/Adobe-CNS1-0.bcmap')

    await expect(
      factory.fetch({ kind: 'wasmUrl', filename: 'openjpeg.wasm' })
    ).resolves.toEqual(Uint8Array.from([4, 5, 6]))
    expect(fetchMock).toHaveBeenCalledWith('/host/wasm/openjpeg.wasm')

    await expect(
      factory.fetch({ kind: 'cMapUrl', filename: 'missing.bcmap' })
    ).rejects.toThrow('Unknown PDF.js resource: cMapUrl/missing.bcmap')
  })

  it('loadPdfjsLib 加载失败后不永久缓存失败结果，允许后续重试成功', async () => {
    runtimeMocks.shouldFailLoad = true
    await expect(loadPdfjsLib()).rejects.toThrow('worker chunk failed')

    runtimeMocks.shouldFailLoad = false
    const lib = await loadPdfjsLib()
    expect(lib.GlobalWorkerOptions.workerSrc).toBe('/assets/pdf.worker.min.mjs')
  })
})
