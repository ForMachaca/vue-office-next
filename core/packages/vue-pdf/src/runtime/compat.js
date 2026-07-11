import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker';
import resourceUrls from 'virtual:pdfjs-compat-resources';

let pdfjsLibPromise;

export class CompatBinaryDataFactory {
    async fetch({ kind, filename }) {
        const url = resourceUrls[kind]?.[filename];
        if (!url) {
            throw new Error(`Unknown PDF.js compat resource: ${kind}/${filename}`);
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Unable to load PDF.js compat resource: ${kind}/${filename}`);
        }
        return new Uint8Array(await response.arrayBuffer());
    }
}

export function loadPdfjsLib() {
    if (!pdfjsLibPromise) {
        pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjsLib) => {
            pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
            return pdfjsLib;
        });
    }

    return pdfjsLibPromise;
}

export function createDocumentOptions(options) {
    return {
        ...options,
        cMapUrl: 'compat://cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'compat://standard-fonts/',
        wasmUrl: 'compat://wasm/',
        useWorkerFetch: false,
        BinaryDataFactory: CompatBinaryDataFactory
    };
}
