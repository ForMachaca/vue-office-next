import workerSrc from 'virtual:pdfjs-worker-url';
import resourceUrls from 'virtual:pdfjs-resources';

let pdfjsLibPromise;

export class CompatBinaryDataFactory {
    async fetch({ kind, filename }) {
        const url = resourceUrls[kind][filename];
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
            pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
            return pdfjsLib;
        }).catch((error) => {
            pdfjsLibPromise = null;
            throw error;
        });
    }

    return pdfjsLibPromise;
}

export function createDocumentOptions(options) {
    return {
        ...options,
        cMapUrl: null,
        cMapPacked: true,
        standardFontDataUrl: null,
        wasmUrl: null,
        useWorkerFetch: false,
        BinaryDataFactory: CompatBinaryDataFactory
    };
}
