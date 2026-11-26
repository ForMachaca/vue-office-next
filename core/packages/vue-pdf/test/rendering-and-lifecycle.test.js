import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VueOfficePdf from '../src/main.vue'

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  globalWorkerOptions: {}
}))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: pdfMocks.getDocument,
  GlobalWorkerOptions: pdfMocks.globalWorkerOptions
}))

vi.mock('virtual:pdfjs-worker-url', () => ({
  default: '/assets/pdf.worker.min.mjs'
}))

vi.mock('virtual:pdfjs-resources', () => ({
  default: {}
}))

function createMockPage({ width = 400, height = 600, rotate = 0, renderFactory } = {}) {
  const cleanup = vi.fn()
  const render = vi.fn(
    renderFactory ||
      (() => ({
        cancel: vi.fn(),
        promise: Promise.resolve()
      }))
  )
  const getViewport = vi.fn(({ scale = 1, rotation }) => {
    const effectiveRotation = rotation !== undefined ? rotation : rotate
    const swapped = effectiveRotation % 180 !== 0
    return {
      width: (swapped ? height : width) * scale,
      height: (swapped ? width : height) * scale
    }
  })

  return {
    rotate,
    cleanup,
    render,
    getViewport
  }
}

function createMockDocument(pages) {
  return {
    numPages: pages.length,
    destroy: vi.fn(() => Promise.resolve()),
    getPage: vi.fn((num) => Promise.resolve(pages[num - 1]))
  }
}

function mockInnerViewport(scroller, width = 420) {
  const wrapper = scroller.querySelector('.vue-office-pdf-wrapper')
  const height = 500
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ width, height, top: 0, bottom: height })
  Object.defineProperties(scroller, {
    clientWidth: { value: width },
    clientHeight: { value: height },
    scrollHeight: { get: () => Math.max(height, 60 + (parseFloat(wrapper.style.height) || 0)) }
  })
  scroller.scrollBy = ({ top }) => {
    scroller.scrollTop = Math.min(Math.max(scroller.scrollTop + top, 0), scroller.scrollHeight - height)
  }
}

describe('VueOfficePdf 渲染、缩放与生命周期', () => {
  let app
  let container

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    pdfMocks.getDocument.mockReset()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({})
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
    container?.remove()
    container = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('setScale 复用已加载文档不重复请求，按真实比例重算尺寸且重绘不重复触发 rendered', async () => {
    const pages = [createMockPage({ width: 400, height: 600 })]
    const doc = createMockDocument(pages)
    pdfMocks.getDocument.mockReturnValue({
      destroy: vi.fn(() => Promise.resolve()),
      promise: Promise.resolve(doc)
    })

    const rendered = vi.fn()
    app = createApp(VueOfficePdf, {
      src: '/files/report.pdf',
      options: { width: 400 },
      onRendered: rendered
    })
    const instance = app.mount(container)

    await vi.waitFor(() => expect(rendered).toHaveBeenCalledTimes(1))
    expect(pdfMocks.getDocument).toHaveBeenCalledTimes(1)

    let canvas = container.querySelector('canvas[data-id="1"]')
    expect(canvas.style.width).toBe('400px')
    expect(canvas.style.height).toBe('600px')

    const beforeZoom = canvas
    instance.setScale(1.5)
    await vi.waitFor(() => {
      canvas = container.querySelector('canvas[data-id="1"]')
      expect(canvas).not.toBe(beforeZoom)
    })

    expect(canvas.style.width).toBe('600px')
    expect(canvas.style.height).toBe('900px')
    expect(pdfMocks.getDocument).toHaveBeenCalledTimes(1)
    expect(rendered).toHaveBeenCalledTimes(1)

    instance.setScale(0.5)
    await vi.waitFor(() => {
      canvas = container.querySelector('canvas[data-id="1"]')
      expect(canvas?.style.width).toBe('200px')
    })
    expect(canvas.style.height).toBe('300px')
    expect(pdfMocks.getDocument).toHaveBeenCalledTimes(1)

    instance.setScale(20)
    await vi.waitFor(() => {
      expect(pages[0].render).toHaveBeenLastCalledWith(expect.objectContaining({
        viewport: { width: 8000, height: 12000 }
      }))
      canvas = container.querySelector('canvas[data-id="1"]')
      expect(canvas.style.width).toBe('8000px')
      expect(canvas.width * canvas.height).toBeLessThanOrEqual(16_000_000)
    })
  })

  it('缩小到内容不再溢出时只调整内层容器，不滚动外层页面', async () => {
    const pages = Array.from({ length: 2 }, () => createMockPage({ width: 400, height: 600 }))
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(createMockDocument(pages)) })
    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/short.pdf', onRendered })
    const instance = app.mount(container)
    const scroller = container.querySelector('.vue-office-pdf')
    const wrapper = scroller.querySelector('.vue-office-pdf-wrapper')
    const contentHeight = () => 60 + (parseFloat(wrapper.style.height) || 0)
    let scrollTop = 0
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ width: 420, height: 500, top: 100, bottom: 600 })
    Object.defineProperties(scroller, {
      clientWidth: { value: 420 },
      clientHeight: { value: 500 },
      scrollHeight: { get: () => Math.max(500, contentHeight()) },
      scrollTop: {
        get: () => Math.max(0, Math.min(scrollTop, contentHeight() - 500)),
        set: (value) => { scrollTop = value }
      }
    })
    scroller.scrollBy = ({ top }) => { scroller.scrollTop += top }
    const windowScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    scroller.scrollTop = 700
    instance.setScale(0.2)
    instance.setScale(1)
    instance.scrollToPage(2)
    instance.setScale(0.2)
    expect(windowScroll).not.toHaveBeenCalled()
  })

  it('连续同步缩放时不清理仍在视口中复用的页面缓存', async () => {
    const page = createMockPage({ width: 400, height: 600 })
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(createMockDocument([page])) })
    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/report.pdf', options: { width: 400 }, onRendered })
    const instance = app.mount(container)

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    instance.setScale(1.5)
    instance.setScale(2)
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(2))
    expect(container.querySelector('canvas[data-id="1"]').style.width).toBe('800px')
    expect(page.cleanup).not.toHaveBeenCalled()
  })

  it('缩放重绘期间保留旧画布并按新尺寸拉伸，新画布绘制完成后再替换', async () => {
    const secondRender = createDeferred()
    const page = createMockPage({ width: 400, height: 600 })
    page.render
      .mockImplementationOnce(() => ({ cancel: vi.fn(), promise: Promise.resolve() }))
      .mockImplementationOnce(() => ({ cancel: vi.fn(), promise: secondRender.promise }))
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(createMockDocument([page])) })
    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/report.pdf', options: { width: 400 }, onRendered })
    const instance = app.mount(container)

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    const previous = container.querySelector('canvas[data-id="1"]')
    instance.setScale(1.5)
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(2))
    expect(container.querySelector('canvas[data-id="1"]')).toBe(previous)
    expect(previous.style.width).toBe('600px')

    secondRender.resolve()
    await vi.waitFor(() => expect(container.querySelector('canvas[data-id="1"]')).not.toBe(previous))
    expect(container.querySelectorAll('canvas')).toHaveLength(1)
    expect(previous.width).toBe(0)
  })

  it('布局就绪后才公布页数，重复跳到当前页时仍等待实际绘制完成', async () => {
    const firstPage = createDeferred()
    const render = createDeferred()
    const page = createMockPage({ renderFactory: () => ({ cancel: vi.fn(), promise: render.promise }) })
    const doc = createMockDocument([page, createMockPage(), createMockPage()])
    doc.getPage.mockReturnValueOnce(firstPage.promise)
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(doc) })

    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/report.pdf', onRendered })
    const instance = app.mount(container)
    mockInnerViewport(container.querySelector('.vue-office-pdf'))

    await vi.waitFor(() => expect(doc.getPage).toHaveBeenCalledWith(1))
    expect(instance.numPages).toBe(0)
    expect(() => instance.scrollToPage(3)).not.toThrow()

    firstPage.resolve(page)
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(1))
    expect(instance.numPages).toBe(3)
    instance.scrollToPage(1)
    expect(onRendered).not.toHaveBeenCalled()

    render.resolve()
    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
  })

  it('滚动增量渲染不重复触发 rendered，同时更新 currentPage 并取消/释放离开视口的页面', async () => {
    const pages = Array.from({ length: 12 }, () => createMockPage({ width: 400, height: 500 }))
    const doc = createMockDocument(pages)
    pdfMocks.getDocument.mockReturnValue({
      destroy: vi.fn(() => Promise.resolve()),
      promise: Promise.resolve(doc)
    })

    const rendered = vi.fn()
    app = createApp(VueOfficePdf, {
      src: '/files/long.pdf',
      options: { width: 400, gap: 10 },
      onRendered: rendered
    })
    const instance = app.mount(container)

    const scroller = container.querySelector('.vue-office-pdf')
    mockInnerViewport(scroller, 500)

    await vi.waitFor(() => expect(rendered).toHaveBeenCalledTimes(1))
    expect(instance.currentPage).toBe(1)
    expect(container.querySelector('canvas[data-id="1"]')).not.toBeNull()

    instance.scrollToPage(9)
    await vi.waitFor(() => {
      expect(container.querySelector('canvas[data-id="9"]')).not.toBeNull()
    })

    expect(instance.currentPage).toBe(9)
    expect(container.querySelector('canvas[data-id="1"]')).toBeNull()
    expect(pages[0].cleanup).toHaveBeenCalled()
    expect(rendered).toHaveBeenCalledTimes(1)
  })

  it('快速切换 src 与卸载时销毁旧 loadingTask、忽略过期结果与 RenderingCancelledException，并回收 Blob ObjectURL', async () => {
    const firstDeferred = createDeferred()
    const secondDeferred = createDeferred()
    const firstDestroy = vi.fn(() => Promise.resolve())
    const secondDestroy = vi.fn(() => Promise.resolve())

    const cancelError = Object.assign(new Error('cancelled'), {
      name: 'RenderingCancelledException'
    })
    const cancellingPage = createMockPage({
      renderFactory: () => ({
        cancel: vi.fn(),
        promise: Promise.reject(cancelError)
      })
    })
    const staleDoc = createMockDocument([createMockPage()])
    const activeDoc = createMockDocument([cancellingPage])

    pdfMocks.getDocument
      .mockReturnValueOnce({ destroy: firstDestroy, promise: firstDeferred.promise })
      .mockReturnValueOnce({ destroy: secondDestroy, promise: secondDeferred.promise })

    const createObjectURL = vi.fn(() => 'blob:mock-pdf-1')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL
    })

    const src = ref(new Blob(['pdf-1'], { type: 'application/pdf' }))
    const onError = vi.fn()
    const onRendered = vi.fn()

    app = createApp({
      render: () =>
        h(VueOfficePdf, {
          src: src.value,
          onError,
          onRendered
        })
    })
    app.mount(container)

    await vi.waitFor(() => expect(pdfMocks.getDocument).toHaveBeenCalledTimes(1))
    expect(createObjectURL).toHaveBeenCalledTimes(1)

    src.value = '/files/second.pdf'
    await nextTick()
    await vi.waitFor(() => expect(pdfMocks.getDocument).toHaveBeenCalledTimes(2))

    expect(firstDestroy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-pdf-1')

    firstDeferred.resolve(staleDoc)
    await Promise.resolve()
    expect(staleDoc.destroy).toHaveBeenCalledTimes(1)

    secondDeferred.resolve(activeDoc)
    await vi.waitFor(() => expect(cancellingPage.render).toHaveBeenCalledTimes(1))
    expect(onRendered).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()

    app.unmount()
    app = undefined
    expect(activeDoc.destroy).toHaveBeenCalledTimes(1)
  })

  it('save 下载当前文档并透传读取错误，切换文档时立即释放旧文档和源 Blob URL 且忽略旧文档下载错误', async () => {
    const readError = new Error('下载读取失败')
    const pendingDownload = createDeferred()
    const firstDoc = createMockDocument([createMockPage()])
    firstDoc.getData = vi.fn()
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
      .mockRejectedValueOnce(readError)
      .mockReturnValueOnce(pendingDownload.promise)
    const secondDoc = createMockDocument([createMockPage()])
    pdfMocks.getDocument
      .mockReturnValueOnce({ promise: Promise.resolve(firstDoc) })
      .mockReturnValueOnce({ promise: Promise.resolve(secondDoc) })

    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn()
        .mockReturnValueOnce('blob:source')
        .mockReturnValueOnce('blob:download'),
      revokeObjectURL
    })
    const downloads = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      downloads.push(this.download)
    })
    const src = ref(new Blob(['document'], { type: 'application/pdf' }))
    const viewer = ref()
    const onRendered = vi.fn()
    const onError = vi.fn()
    app = createApp({
      render: () => h(VueOfficePdf, { src: src.value, ref: viewer, onRendered, onError })
    })
    app.mount(container)

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    vi.useFakeTimers()
    viewer.value.save('saved.pdf')
    viewer.value.save('failed.pdf')
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    expect(downloads).toEqual(['saved.pdf'])
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download')
    expect(onError).toHaveBeenCalledWith(readError)

    viewer.value.save('pending.pdf')
    src.value = '/files/second.pdf'
    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(2))
    expect(firstDoc.destroy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:source')
    expect(secondDoc.destroy).not.toHaveBeenCalled()

    pendingDownload.reject(new Error('Worker was terminated.'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('新文件加载失败时清除旧文档的占位尺寸和滚动位置', async () => {
    const firstDoc = createMockDocument(Array.from({ length: 100 }, () => createMockPage()))
    const replacement = createDeferred()
    pdfMocks.getDocument
      .mockReturnValueOnce({ promise: Promise.resolve(firstDoc) })
      .mockReturnValueOnce({ destroy: vi.fn(() => Promise.resolve()), promise: replacement.promise })

    const src = ref('/files/long.pdf')
    const onRendered = vi.fn()
    const onError = vi.fn()
    app = createApp({
      render: () => h(VueOfficePdf, { src: src.value, options: { width: 800 }, onRendered, onError })
    })
    app.mount(container)
    const scroller = container.querySelector('.vue-office-pdf')
    const wrapper = scroller.querySelector('.vue-office-pdf-wrapper')
    mockInnerViewport(scroller)

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    expect(parseFloat(wrapper.style.height)).toBeGreaterThan(500)
    expect(wrapper.style.width).toBe('820px')
    scroller.scrollTop = 5000
    scroller.scrollLeft = 120

    src.value = '/files/invalid.pdf'
    await vi.waitFor(() => expect(pdfMocks.getDocument).toHaveBeenCalledTimes(2))
    expect(wrapper.style.height).toBe('')
    expect(wrapper.style.width).toBe('')
    expect(scroller.scrollTop).toBe(0)
    expect(scroller.scrollLeft).toBe(0)

    const loadError = new Error('新文件加载失败')
    replacement.reject(loadError)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(loadError))
    expect(wrapper.querySelector('canvas')).toBeNull()
    expect(wrapper.style.height).toBe('')
    expect(wrapper.style.width).toBe('')
  })

  it('混合尺寸页面保留各自宽高比并更新累计垂直偏移', async () => {
    const portrait = createMockPage({ width: 400, height: 600 })
    const landscape = createMockPage({ width: 800, height: 300 })
    const third = createMockPage({ width: 400, height: 600 })
    const doc = createMockDocument([portrait, landscape, third])

    pdfMocks.getDocument.mockReturnValue({
      destroy: vi.fn(() => Promise.resolve()),
      promise: Promise.resolve(doc)
    })

    const rendered = vi.fn()
    app = createApp(VueOfficePdf, {
      src: '/files/mixed.pdf',
      options: { width: 400, gap: 10 },
      onRendered: rendered
    })
    app.mount(container)

    await vi.waitFor(() => expect(rendered).toHaveBeenCalledTimes(1))

    const canvas1 = container.querySelector('canvas[data-id="1"]')
    const canvas2 = container.querySelector('canvas[data-id="2"]')
    const canvas3 = container.querySelector('canvas[data-id="3"]')

    expect(canvas1.style.width).toBe('400px')
    expect(canvas1.style.height).toBe('600px')
    expect(canvas1.style.top).toBe('30px')
    expect(canvas2.style.width).toBe('800px')
    expect(canvas2.style.height).toBe('300px')
    expect(canvas2.style.top).toBe('640px')
    expect(canvas3.style.top).toBe('950px')
  })

  it('跳页后测得前置页面更矮时，目标页仍停留在视口顶部', async () => {
    const pages = Array.from({ length: 12 }, (_, index) => createMockPage({
      height: index === 6 || index === 7 ? 100 : 600
    }))
    const doc = createMockDocument(pages)
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(doc) })

    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/mixed.pdf', onRendered })
    const instance = app.mount(container)
    const scroller = container.querySelector('.vue-office-pdf')
    mockInnerViewport(scroller)

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    instance.scrollToPage(9)

    await vi.waitFor(() => {
      const targetCanvas = scroller.querySelector('canvas[data-id="9"]')
      expect(targetCanvas.style.top).toBe('3910px')
      expect(scroller.scrollTop).toBe(3910)
      expect(instance.currentPage).toBe(9)
    })
  })

  it('容器自动增高时按滚动祖先的视口挂载页面', async () => {
    const pages = Array.from({ length: 100 }, () => createMockPage())
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(createMockDocument(pages)) })
    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/long.pdf', onRendered })
    const instance = app.mount(container)
    const scroller = container.querySelector('.vue-office-pdf')
    const wrapper = scroller.querySelector('.vue-office-pdf-wrapper')
    const documentHeight = () => 60 + (parseFloat(wrapper.style.height) || 0)
    container.style.overflowY = 'auto'
    Object.defineProperties(container, {
      clientHeight: { value: 500 },
      scrollHeight: { get: documentHeight }
    })
    container.scrollBy = ({ top }) => { container.scrollTop += top }
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 500 })
    vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => {
      const top = 100 - container.scrollTop
      const height = documentHeight()
      return { width: 420, top, height, bottom: top + height }
    })
    Object.defineProperties(scroller, {
      clientHeight: { get: documentHeight },
      scrollHeight: { get: documentHeight }
    })

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    expect(wrapper.querySelectorAll('canvas')).toHaveLength(3)

    container.scrollTop = 5520
    container.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(instance.currentPage).toBe(10))
    expect(wrapper.querySelector('canvas[data-id="1"]')).toBeNull()
    expect(wrapper.querySelector('canvas[data-id="10"]')).not.toBeNull()

    instance.scrollToPage(12)
    expect(container.scrollTop).toBe(6740)
    expect(wrapper.querySelector('canvas[data-id="12"]')).not.toBeNull()
  })

  it('缩放混合页高文档时保留当前页和页内滚动位置', async () => {
    const pages = Array.from({ length: 20 }, (_, index) => createMockPage({
      height: index === 1 || index === 2 ? 3000 : 600
    }))
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(createMockDocument(pages)) })
    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/mixed.pdf', onRendered })
    const instance = app.mount(container)
    const scroller = container.querySelector('.vue-office-pdf')
    mockInnerViewport(scroller)

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    scroller.scrollTop = 10420
    scroller.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(instance.currentPage).toBe(10))

    instance.setScale(1.5)
    await vi.waitFor(() => expect(pages[9].render).toHaveBeenLastCalledWith(expect.objectContaining({
      viewport: { width: 600, height: 900 }
    })))
    expect(instance.currentPage).toBe(10)
    expect(scroller.scrollTop).toBe(15570)
  })

  it('末页跳转保留目标，前置页面测高后将末页滚入视口', async () => {
    const pages = Array.from({ length: 12 }, (_, index) => createMockPage({
      height: index === 8 ? 2000 : 100
    }))
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(createMockDocument(pages)) })
    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/mixed.pdf', onRendered })
    const instance = app.mount(container)
    const scroller = container.querySelector('.vue-office-pdf')
    mockInnerViewport(scroller)

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    instance.scrollToPage(12)
    await vi.waitFor(() => expect(pages[11].render).toHaveBeenCalled())
    expect(instance.currentPage).toBe(12)
    expect(scroller.scrollTop).toBe(2770)
    expect(scroller.querySelector('canvas[data-id="12"]').style.top).toBe('3140px')

    scroller.scrollTop = 0
    scroller.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(instance.currentPage).toBe(2))
  })

  it('内层和滚动祖先都到达边界时，继续滚动窗口直到末页可见', async () => {
    const pages = Array.from({ length: 100 }, () => createMockPage({ height: 100 }))
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(createMockDocument(pages)) })
    const onRendered = vi.fn()
    container.style.overflowY = 'auto'
    app = createApp(VueOfficePdf, { src: '/files/long.pdf', onRendered })
    const instance = app.mount(container)
    const scroller = container.querySelector('.vue-office-pdf')
    const wrapper = scroller.querySelector('.vue-office-pdf-wrapper')

    const windowHeight = 600
    const outerHeight = 1100
    const viewerHeight = 1200
    let windowTop = 0
    vi.stubGlobal('innerHeight', windowHeight)
    vi.spyOn(window, 'scrollBy').mockImplementation(({ top }) => {
      windowTop = Math.min(windowTop + top, outerHeight - windowHeight)
    })
    vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({ top: -windowTop }))
    vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => {
      const top = -windowTop - container.scrollTop
      return { width: 420, height: viewerHeight, top, bottom: top + viewerHeight }
    })
    Object.defineProperties(container, {
      clientHeight: { value: outerHeight },
      scrollHeight: { value: viewerHeight }
    })
    Object.defineProperties(scroller, {
      clientHeight: { value: viewerHeight },
      scrollHeight: { get: () => 60 + (parseFloat(wrapper.style.height) || 0) }
    })
    container.scrollBy = ({ top }) => {
      container.scrollTop = Math.min(container.scrollTop + top, viewerHeight - outerHeight)
    }
    scroller.scrollBy = ({ top }) => {
      scroller.scrollTop = Math.min(scroller.scrollTop + top, scroller.scrollHeight - viewerHeight)
    }

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    instance.scrollToPage(100)
    await vi.waitFor(() => expect(pages[99].render).toHaveBeenCalled())

    expect(instance.currentPage).toBe(100)
    expect(scroller.scrollTop).toBe(9850)
    expect(container.scrollTop).toBeGreaterThan(0)
    expect(windowTop).toBeGreaterThan(0)
    const canvas = wrapper.querySelector('canvas[data-id="100"]')
    const visibleTop = scroller.getBoundingClientRect().top + parseFloat(canvas.style.top) - scroller.scrollTop
    expect(visibleTop).toBeGreaterThanOrEqual(0)
    expect(visibleTop).toBeLessThan(windowHeight)
  })

  it('支持 defaultScale、setRotation 以及 ResizeObserver 容器宽度自适应', async () => {
    let resizeCallback = null
    class MockResizeObserver {
      constructor(cb) {
        resizeCallback = cb
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    const page = createMockPage({ width: 300, height: 500 })
    const doc = createMockDocument([page])
    pdfMocks.getDocument.mockReturnValue({
      destroy: vi.fn(() => Promise.resolve()),
      promise: Promise.resolve(doc)
    })

    const rendered = vi.fn()
    app = createApp(VueOfficePdf, {
      src: '/files/rotatable.pdf',
      defaultScale: 0.5,
      onRendered: rendered
    })
    const instance = app.mount(container)

    let containerWidth = 620
    const scroller = container.querySelector('.vue-office-pdf')
    vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => ({
      width: containerWidth,
      height: 600,
      top: 0,
      left: 0,
      right: containerWidth,
      bottom: 600
    }))
    Object.defineProperty(scroller, 'clientWidth', { get: () => containerWidth })

    await vi.waitFor(() => expect(rendered).toHaveBeenCalledTimes(1))

    // baseFitScale = min((620 - 20) / 300, 2) = 2; defaultScale = 0.5 => renderScale = 1
    let canvas = container.querySelector('canvas[data-id="1"]')
    expect(canvas.style.width).toBe('300px')
    expect(canvas.style.height).toBe('500px')

    // 旋转 90° 后宽高交换且不重新请求 PDF
    instance.setRotation(90)
    await vi.waitFor(() => {
      canvas = container.querySelector('canvas[data-id="1"]')
      expect(canvas?.style.width).toBe('300px')
      expect(canvas?.style.height).toBe('180px')
    })
    expect(instance.rotation).toBe(90)
    expect(pdfMocks.getDocument).toHaveBeenCalledTimes(1)
    instance.setRotation(Number.NaN)
    expect(instance.rotation).toBe(90)

    // 模拟全屏切换：容器宽度扩大到 1020px（baseFitScale = 1000 / 500 = 2, scale = 0.5 => 500x300）
    vi.useFakeTimers()
    containerWidth = 1020
    resizeCallback?.()
    vi.advanceTimersByTime(150)
    vi.useRealTimers()

    await vi.waitFor(() => {
      canvas = container.querySelector('canvas[data-id="1"]')
      expect(canvas?.style.width).toBe('500px')
      expect(canvas?.style.height).toBe('300px')
    })
    expect(pdfMocks.getDocument).toHaveBeenCalledTimes(1)
  })

  it('显式 options.width 时容器宽度变化只更新包裹层宽度，不重新渲染页面', async () => {
    let resizeCallback = null
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb) {
        resizeCallback = cb
      }
      observe() {}
      disconnect() {}
    })
    const page = createMockPage({ width: 400, height: 600 })
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(createMockDocument([page])) })
    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/report.pdf', options: { width: 800 }, onRendered })
    app.mount(container)
    const scroller = container.querySelector('.vue-office-pdf')
    const wrapper = scroller.querySelector('.vue-office-pdf-wrapper')
    let containerWidth = 1000
    Object.defineProperty(scroller, 'clientWidth', { get: () => containerWidth })

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    expect(wrapper.style.width).toBe('100%')

    vi.useFakeTimers()
    containerWidth = 600
    resizeCallback()
    vi.advanceTimersByTime(150)
    vi.useRealTimers()
    expect(wrapper.style.width).toBe('820px')
    expect(page.render).toHaveBeenCalledTimes(1)
  })

  it('适配宽度扣除容器内边距与滚动条，页面不溢出内容区', async () => {
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve(createMockDocument([createMockPage({ width: 400, height: 600 })]))
    })
    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/report.pdf', onRendered })
    app.mount(container)
    const scroller = container.querySelector('.vue-office-pdf')
    scroller.style.padding = '16px'
    scroller.style.border = '2px solid'
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ width: 473, height: 500, top: 0, bottom: 500 })
    Object.defineProperty(scroller, 'clientWidth', { value: 452 })

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    expect(container.querySelector('canvas[data-id="1"]').style.width).toBe('400px')
  })

  it('容器有上内边距时跳页仍让目标页贴齐视口顶部', async () => {
    const pages = Array.from({ length: 12 }, () => createMockPage({ width: 400, height: 600 }))
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(createMockDocument(pages)) })
    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/long.pdf', options: { width: 400 }, onRendered })
    const instance = app.mount(container)
    const scroller = container.querySelector('.vue-office-pdf')
    scroller.style.paddingTop = '80px'
    mockInnerViewport(scroller)

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    instance.scrollToPage(9)
    expect(scroller.scrollTop).toBe(80 + 30 + 8 * 610)
    expect(instance.currentPage).toBe(9)
  })

  it('离开视口页面的 getPage 迟到失败时不触发 error', async () => {
    const pageTwo = createDeferred()
    const pages = Array.from({ length: 12 }, () => createMockPage({ width: 400, height: 600 }))
    const doc = createMockDocument(pages)
    doc.getPage.mockImplementation((num) => (num === 2 ? pageTwo.promise : Promise.resolve(pages[num - 1])))
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(doc) })
    const onRendered = vi.fn()
    const onError = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/long.pdf', options: { width: 400 }, onRendered, onError })
    const instance = app.mount(container)
    mockInnerViewport(container.querySelector('.vue-office-pdf'))

    await vi.waitFor(() => expect(doc.getPage).toHaveBeenCalledWith(2))
    instance.scrollToPage(12)
    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    pageTwo.reject(new Error('第 2 页加载失败'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onError).not.toHaveBeenCalled()
  })

  it('首屏 getPage(1) 失败时销毁文档实例且不覆盖消费方 max-height 样式', async () => {
    const pageError = new Error('corrupt page 1')
    const doc = {
      numPages: 2,
      destroy: vi.fn(() => Promise.resolve()),
      getPage: vi.fn(() => Promise.reject(pageError))
    }
    pdfMocks.getDocument.mockReturnValue({
      destroy: vi.fn(() => Promise.resolve()),
      promise: Promise.resolve(doc)
    })

    const onError = vi.fn()
    app = createApp(VueOfficePdf, {
      src: '/files/corrupt.pdf',
      onError
    })
    const instance = app.mount(container)

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(pageError))
    expect(doc.destroy).toHaveBeenCalledTimes(1)
    expect(instance.numPages).toBe(0)
    expect(container.querySelector('.vue-office-pdf').style.maxHeight).toBe('')
  })

  it('极端细长页面同时受 Canvas 单边与面积上限约束', async () => {
    const skinnyPage = createMockPage({ width: 10, height: 25000 })
    const doc = createMockDocument([skinnyPage])
    pdfMocks.getDocument.mockReturnValue({
      destroy: vi.fn(() => Promise.resolve()),
      promise: Promise.resolve(doc)
    })

    const rendered = vi.fn()
    app = createApp(VueOfficePdf, {
      src: '/files/skinny.pdf',
      onRendered: rendered
    })
    app.mount(container)

    await vi.waitFor(() => expect(rendered).toHaveBeenCalledTimes(1))
    const canvas = container.querySelector('canvas[data-id="1"]')
    expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(16_384)
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(16_000_000)
  })

  it('不支持 behavior: instant 或无 scrollBy 时优雅回退滚动且不抛错', async () => {
    const pages = Array.from({ length: 10 }, () => createMockPage({ width: 400, height: 500 }))
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(createMockDocument(pages)) })
    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/compat-scroll.pdf', options: { width: 400, gap: 10 }, onRendered })
    const instance = app.mount(container)
    const scroller = container.querySelector('.vue-office-pdf')
    const wrapper = scroller.querySelector('.vue-office-pdf-wrapper')

    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ width: 420, height: 500, top: 0, bottom: 500 })
    Object.defineProperties(scroller, {
      clientHeight: { value: 500 },
      scrollHeight: { get: () => Math.max(500, 60 + (parseFloat(wrapper.style.height) || 0)) }
    })
    // 模拟 Chromium 102：behavior: 'instant' 抛 TypeError
    scroller.scrollBy = vi.fn((arg) => {
      if (typeof arg === 'object' && arg?.behavior === 'instant') {
        throw new TypeError("Failed to execute 'scrollBy': 'instant' is not a valid enum value")
      }
    })

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    expect(() => instance.scrollToPage(5)).not.toThrow()
    expect(scroller.scrollTop).toBe(2070)
    expect(instance.currentPage).toBe(5)

    // 模拟 jsdom：元素无 scrollBy 方法
    scroller.scrollBy = undefined
    expect(() => instance.scrollToPage(8)).not.toThrow()
    expect(scroller.scrollTop).toBe(3600)
    expect(instance.currentPage).toBe(8)
  })

  it('overflow-y: hidden 祖先不作为滚动目标，亚像素滚动误差不误清跳页锚点', async () => {
    const pages = Array.from({ length: 12 }, (_, index) => createMockPage({
      height: index === 6 || index === 7 ? 100 : 600
    }))
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve(createMockDocument(pages)) })
    const onRendered = vi.fn()
    app = createApp(VueOfficePdf, { src: '/files/hidden-ancestor.pdf', onRendered })
    const instance = app.mount(container)
    const scroller = container.querySelector('.vue-office-pdf')
    const wrapper = scroller.querySelector('.vue-office-pdf-wrapper')

    // 模拟 overflow: hidden 且略微溢出的外层祖先（如 el-dialog / el-card）
    container.style.overflowY = 'hidden'
    Object.defineProperties(container, {
      clientHeight: { value: 500 },
      scrollHeight: { value: 800 }
    })
    container.scrollBy = vi.fn()
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 500 })

    let subpixelShift = 0
    vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => ({
      width: 420,
      height: 500,
      top: subpixelShift,
      bottom: 500 + subpixelShift
    }))
    Object.defineProperties(scroller, {
      clientHeight: { value: 500 },
      scrollHeight: { get: () => Math.max(500, 60 + (parseFloat(wrapper.style.height) || 0)) }
    })
    scroller.scrollBy = ({ top }) => {
      scroller.scrollTop = Math.min(Math.max(scroller.scrollTop + top, 0), scroller.scrollHeight - 500)
    }

    await vi.waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1))
    instance.scrollToPage(9)
    expect(container.scrollBy).not.toHaveBeenCalled()

    // 模拟 0.4px 亚像素抖动触发原生 scroll 事件，不应清空 pageJump
    subpixelShift = 0.4
    scroller.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => {
      const targetCanvas = scroller.querySelector('canvas[data-id="9"]')
      expect(targetCanvas.style.top).toBe('3910px')
      expect(instance.currentPage).toBe(9)
    })
  })
})
