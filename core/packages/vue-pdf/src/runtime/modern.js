let pdfjsLibPromise;

export function loadPdfjsLib() {
    if (!pdfjsLibPromise) {
        pdfjsLibPromise = Promise.all([
            import('pdfjs-dist/legacy/build/pdf.mjs'),
            import('virtual:pdfjs-worker-url')
        ]).then(([pdfjsLib, { default: workerSrc }]) => {
            pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
            return pdfjsLib;
        });
    }

    return pdfjsLibPromise;
}

export function createDocumentOptions(options) {
    return options;
}
