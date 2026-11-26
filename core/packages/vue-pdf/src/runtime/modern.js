let pdfjsLibPromise;
let resourceUrlsPromise;

function loadResourceUrls() {
    if (!resourceUrlsPromise) {
        resourceUrlsPromise = import('virtual:pdfjs-resources')
            .then((mod) => mod.default)
            .catch((error) => {
                resourceUrlsPromise = null;
                throw error;
            });
    }

    return resourceUrlsPromise;
}

export class ModernBinaryDataFactory {
    constructor({ cMapUrl, standardFontDataUrl, wasmUrl }) {
        this.cMapUrl = cMapUrl;
        this.standardFontDataUrl = standardFontDataUrl;
        this.wasmUrl = wasmUrl;
    }

    async fetch({ kind, filename }) {
        const baseUrl = this[kind];
        const url = baseUrl
            ? `${baseUrl}${filename}`
            : (await loadResourceUrls())[kind][filename];
        if (!url) {
            throw new Error(`Unknown PDF.js resource: ${kind}/${filename}`);
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Unable to load PDF.js resource: ${kind}/${filename}`);
        }
        return new Uint8Array(await response.arrayBuffer());
    }
}

export function loadPdfjsLib() {
    if (!pdfjsLibPromise) {
        pdfjsLibPromise = Promise.all([
            import('pdfjs-dist/legacy/build/pdf.mjs'),
            import('virtual:pdfjs-worker-url')
        ]).then(([pdfjsLib, { default: workerSrc }]) => {
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
    if (options.BinaryDataFactory || (options.cMapUrl && options.standardFontDataUrl && options.wasmUrl)) {
        return options;
    }

    return {
        ...options,
        useWorkerFetch: false,
        BinaryDataFactory: ModernBinaryDataFactory
    };
}
