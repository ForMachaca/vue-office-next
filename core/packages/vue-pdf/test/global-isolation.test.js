import { createApp, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VueOfficePdf from '../src/main.vue'

const pdfMocks = vi.hoisted(() => {
  const pdfPage = {
    getViewport: vi.fn(({ scale }) => ({
      width: 100 * scale,
      height: 200 * scale
    })),
    render: vi.fn(() => ({ promise: Promise.resolve() }))
  }
  const pdfDocument = {
    destroy: vi.fn(),
    getPage: vi.fn(() => Promise.resolve(pdfPage)),
    numPages: 1
  }

  return {
    getDocument: vi.fn(() => ({
      promise: Promise.resolve(pdfDocument)
    })),
    globalWorkerOptions: {},
    pdfDocument
  }
})

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: pdfMocks.getDocument,
  GlobalWorkerOptions: pdfMocks.globalWorkerOptions
}))

vi.mock('virtual:pdfjs-worker-url', () => ({
  default: '/assets/pdf.worker.min.mjs'
}))

describe('VueOfficePdf PDF.js 隔离', () => {
  let app

  beforeEach(() => {
    pdfMocks.pdfDocument.numPages = 1
    pdfMocks.getDocument.mockReset()
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve(pdfMocks.pdfDocument)
    })
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
    Reflect.deleteProperty(window, 'pdfjsLib')
    vi.restoreAllMocks()
  })

  it('不读取或覆盖宿主的 pdfjsLib', async () => {
    const hostGetDocument = vi.fn(() => ({
      promise: Promise.resolve(pdfMocks.pdfDocument)
    }))
    const hostPdfjsLib = {
      version: '5.7.284',
      GlobalWorkerOptions: {
        workerSrc: '/assets/host-pdf.worker.min.mjs'
      },
      getDocument: hostGetDocument
    }

    Object.defineProperty(window, 'pdfjsLib', {
      configurable: true,
      value: hostPdfjsLib
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({})
    const rendered = vi.fn()
    const container = document.createElement('div')

    app = createApp({
      render: () =>
        h(VueOfficePdf, {
          src: '/files/report.pdf',
          options: {
            wasmUrl: '/pdfjs/wasm/'
          },
          onRendered: rendered
        })
    })
    app.mount(container)

    await Promise.resolve()
    await nextTick()
    await vi.waitFor(() => expect(rendered).toHaveBeenCalled())

    expect(hostGetDocument).not.toHaveBeenCalled()
    expect(window.pdfjsLib).toBe(hostPdfjsLib)
    expect(pdfMocks.globalWorkerOptions.workerSrc).toBe('/assets/pdf.worker.min.mjs')
    expect(pdfMocks.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/files/report.pdf',
        wasmUrl: '/pdfjs/wasm/'
      })
    )
  })

  it('渲染后通过组件实例暴露实际 PDF 页数', async () => {
    pdfMocks.pdfDocument.numPages = 3
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({})
    const rendered = vi.fn()
    const container = document.createElement('div')

    app = createApp(VueOfficePdf, {
      src: '/files/report.pdf',
      onRendered: rendered
    })
    const instance = app.mount(container)

    await vi.waitFor(() => expect(rendered).toHaveBeenCalled())

    expect(instance.numPages).toBe(3)
  })

  it('私有 PDF.js 加载失败时通过 error 事件透传原始错误', async () => {
    const loadingError = new Error('invalid pdf')
    pdfMocks.getDocument.mockReturnValueOnce({
      promise: Promise.reject(loadingError)
    })
    const onError = vi.fn()
    const container = document.createElement('div')

    app = createApp({
      render: () =>
        h(VueOfficePdf, {
          src: '/files/invalid.pdf',
          onError
        })
    })
    app.mount(container)

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(loadingError))
  })
})
