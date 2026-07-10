import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

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

export default defineConfig({
  plugins: [pdfWorkerStub, vue()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js']
  }
})
