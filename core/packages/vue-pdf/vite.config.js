import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pdfjsDirectory = dirname(require.resolve('pdfjs-dist/package.json'));
const pdfWorkerPath = require.resolve(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
);
const pdfWorkerVirtualId = 'virtual:pdfjs-worker-url';
const resolvedPdfWorkerVirtualId = '\0' + pdfWorkerVirtualId;
const pdfResourcesVirtualId = 'virtual:pdfjs-resources';
const resolvedPdfResourcesVirtualId = '\0' + pdfResourcesVirtualId;
const resourceDirectories = {
  cMapUrl: 'cmaps',
  standardFontDataUrl: 'standard_fonts',
  wasmUrl: 'wasm'
};
const runtimeResourcePattern = /\.(bcmap|pfb|ttf)$|^(jbig2|openjpeg)\.wasm$/;
const runtimeLicensePattern = /^LICENSE(_FOXIT|_LIBERATION|(_PDFJS)?_(JBIG2|OPENJPEG))?$/;
const hostWorkerRead = 'globalThis.pdfjsWorker?.WorkerMessageHandler';
const hostWorkerWrite = 'globalThis.pdfjsWorker={WorkerMessageHandler};';

function isPdfjsModule(id) {
  return id.split('?')[0].endsWith('/pdfjs-dist/legacy/build/pdf.mjs');
}

function isolatePdfjsModule(code) {
  const globalStart = code.lastIndexOf('\n{\n  globalThis._pdfjsTestingUtils = {');
  const exportStart = code.indexOf('\nexport {', globalStart);
  if (globalStart === -1 || exportStart === -1 || !code.includes(hostWorkerRead)) {
    throw new Error('pdfjs-dist@5.7.284 global access points were not found');
  }
  return (code.slice(0, globalStart) + code.slice(exportStart)).replace(hostWorkerRead, 'null');
}

function isolatePdfjsWorker(code) {
  if (!code.includes(hostWorkerWrite)) {
    throw new Error('pdfjs-dist@5.7.284 worker global assignment was not found');
  }
  return code.replace(hostWorkerWrite, '');
}

function emitTypes() {
  return {
    name: 'emit-vue-office-pdf-types',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'index.d.ts',
        source: readFileSync(resolve(import.meta.dirname, 'index.d.ts'), 'utf8')
      });
    }
  };
}

function emitPdfWorker(assetBaseDir) {
  let workerReferenceId;

  return {
    name: 'emit-pdfjs-worker',
    apply: 'build',
    buildStart() {
      workerReferenceId = this.emitFile({
        type: 'asset',
        ...(assetBaseDir
          ? { fileName: `${assetBaseDir}/pdf.worker.min.js` }
          : { name: 'pdf.worker.min.js' }),
        source: isolatePdfjsWorker(readFileSync(pdfWorkerPath, 'utf8'))
      });
    },
    resolveId(id) {
      return id === pdfWorkerVirtualId ? resolvedPdfWorkerVirtualId : null;
    },
    load(id) {
      if (id !== resolvedPdfWorkerVirtualId) {
        return null;
      }
      return (
        'export default import.meta.ROLLUP_FILE_URL_' +
        workerReferenceId +
        ';'
      );
    }
  };
}

function emitPdfResources(assetBaseDir) {
  const resourceReferences = {};

  return {
    name: 'emit-pdfjs-resources',
    apply: 'build',
    buildStart() {
      for (const [kind, directoryName] of Object.entries(resourceDirectories)) {
        const directory = resolve(pdfjsDirectory, directoryName);
        const files = readdirSync(directory);
        const emit = (filename) => this.emitFile({
          type: 'asset',
          fileName: `${assetBaseDir}/${directoryName}/${filename}`,
          source: readFileSync(resolve(directory, filename))
        });
        files.filter((filename) => runtimeLicensePattern.test(filename)).forEach(emit);
        resourceReferences[kind] = Object.fromEntries(
          files
            .filter((filename) => runtimeResourcePattern.test(filename))
            .map((filename) => [filename, emit(filename)])
        );
      }
    },
    resolveId(id) {
      return id === pdfResourcesVirtualId
        ? resolvedPdfResourcesVirtualId
        : null;
    },
    load(id) {
      if (id !== resolvedPdfResourcesVirtualId) {
        return null;
      }

      const entries = Object.entries(resourceReferences).map(
        ([kind, references]) => {
          const files = Object.entries(references).map(
            ([filename, referenceId]) =>
              `${JSON.stringify(filename)}: import.meta.ROLLUP_FILE_URL_${referenceId}`
          );
          return `${JSON.stringify(kind)}: {${files.join(',')}}`;
        }
      );
      return `export default {${entries.join(',')}};`;
    }
  };
}

function isolatePdfjsGlobal() {
  let transformed = false;

  return {
    name: 'isolate-pdfjs-global',
    enforce: 'pre',
    transform(code, id) {
      if (!isPdfjsModule(id)) {
        return null;
      }
      transformed = true;
      return { code: isolatePdfjsModule(code), map: null };
    },
    buildEnd(error) {
      if (!error && !transformed) {
        this.error('pdfjs-dist@5.7.284 was not transformed into an isolated module');
      }
    }
  };
}

export function vueOfficePdfSource() {
  const imports = [];
  const resources = Object.entries(resourceDirectories).map(([kind, directoryName]) => {
    const directory = resolve(pdfjsDirectory, directoryName);
    const files = readdirSync(directory).filter((filename) => runtimeResourcePattern.test(filename)).map((filename) => {
      const name = `resource${imports.length}`;
      imports.push(`import ${name} from ${JSON.stringify(`${resolve(directory, filename)}?url`)};`);
      return `${JSON.stringify(filename)}: ${name}`;
    });
    return `${JSON.stringify(kind)}: {${files.join(',')}}`;
  });
  const resourcesModule = `${imports.join('\n')}\nexport default {${resources.join(',')}};`;

  return [
    emitPdfWorker(),
    {
      name: 'vue-office-pdf-source-worker',
      apply: 'serve',
      resolveId(id) {
        return id === pdfWorkerVirtualId ? resolvedPdfWorkerVirtualId : null;
      },
      load(id) {
        return id === resolvedPdfWorkerVirtualId
          ? `export { default } from ${JSON.stringify(`${pdfWorkerPath}?url`)};`
          : null;
      },
      transform(code, id) {
        const [file, query] = id.split('?');
        return file.endsWith('/pdfjs-dist/legacy/build/pdf.worker.min.mjs') && !new URLSearchParams(query).has('url')
          ? { code: isolatePdfjsWorker(code), map: null }
          : null;
      }
    },
    {
      name: 'vue-office-pdf-source',
      enforce: 'pre',
      config: () => ({ optimizeDeps: { exclude: ['pdfjs-dist'] } }),
      resolveId(id) {
        if (id === 'virtual:vue-office-pdf-runtime') {
          return resolve(import.meta.dirname, 'src/runtime/modern.js');
        }
        return id === pdfResourcesVirtualId ? resolvedPdfResourcesVirtualId : null;
      },
      load(id) {
        return id === resolvedPdfResourcesVirtualId ? resourcesModule : null;
      },
      transform(code, id) {
        return isPdfjsModule(id) ? { code: isolatePdfjsModule(code), map: null } : null;
      }
    }
  ];
}

export default defineConfig(({ mode }) => {
  const isCompat = mode === 'compat';

  return {
    base: './',
    resolve: {
      alias: {
        'virtual:vue-office-pdf-runtime': resolve(
          import.meta.dirname,
          isCompat ? 'src/runtime/compat.js' : 'src/runtime/modern.js'
        )
      }
    },
    plugins: [
      emitPdfWorker(isCompat ? 'assets' : 'compat/assets'),
      emitPdfResources(isCompat ? 'assets' : 'compat/assets'),
      emitTypes(),
      isolatePdfjsGlobal(),
      vue()
    ],
    build: {
      target: isCompat ? 'chrome102' : 'es2020',
      outDir: isCompat ? 'lib/compat' : 'lib',
      emptyOutDir: !isCompat,
      lib: {
        entry: resolve(import.meta.dirname, isCompat ? 'compat.js' : 'index.js'),
        formats: ['es'],
        fileName: () => 'index.js'
      },
      rollupOptions: {
        external: ['vue'],
        output: {
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    }
  };
});
