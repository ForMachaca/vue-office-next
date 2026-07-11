import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

const pdfWorkerVirtualId = 'virtual:pdfjs-worker-url'
const resolvedPdfWorkerVirtualId = '\0' + pdfWorkerVirtualId
const pdfWorkerStub = {
  name: 'pdf-worker-stub',
  resolveId(id) {
    return id === pdfWorkerVirtualId ? resolvedPdfWorkerVirtualId : null
  },
  load(id) {
    return id === resolvedPdfWorkerVirtualId
      ? "export default '/assets/pdf.worker.min.mjs'"
      : null
  }
}

const compatResourcesVirtualId = 'virtual:pdfjs-compat-resources'
const resolvedCompatResourcesVirtualId = '\0' + compatResourcesVirtualId
const compatResourcesStub = {
  name: 'pdf-compat-resources-stub',
  resolveId(id) {
    return id === compatResourcesVirtualId
      ? resolvedCompatResourcesVirtualId
      : null
  },
  load(id) {
    return id === resolvedCompatResourcesVirtualId ? 'export default {}' : null
  }
}

export default defineConfig({
  resolve: {
    alias: {
      'virtual:vue-office-pdf-runtime': resolve(
        import.meta.dirname,
        'src/runtime/modern.js'
      )
    }
  },
  plugins: [pdfWorkerStub, compatResourcesStub, vue()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js']
  }
})
