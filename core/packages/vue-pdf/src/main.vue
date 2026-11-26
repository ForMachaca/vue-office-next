<script>
import { defineComponent, ref, onMounted, watch, onBeforeUnmount } from 'vue';
import { createDocumentOptions, loadPdfjsLib } from 'virtual:vue-office-pdf-runtime';

const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_CANVAS_DIMENSION = 16_384;
const RESIZE_WIDTH_THRESHOLD = 20;

function createDebounce(fn, wait) {
    let timer = null;
    function debounced(...args) {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, wait);
    }
    debounced.cancel = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };
    return debounced;
}

function isRenderCancelled(error) {
    return Boolean(error && error.name === 'RenderingCancelledException');
}

function normalizeRotation(deg) {
    if (!Number.isFinite(deg)) {
        return null;
    }
    const quarterTurns = Math.round(deg / 90);
    return (((quarterTurns * 90) % 360) + 360) % 360;
}

function resolvePositiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export default defineComponent({
    name: 'VueOfficePdf',
    props: {
        src: [String, ArrayBuffer, Blob],
        requestOptions: {
            type: Object,
            default: () => ({})
        },
        staticFileUrl: {
            type: String,
            default: ''
        },
        options: {
            type: Object,
            default: () => ({})
        },
        defaultScale: {
            type: Number,
            default: 1
        }
    },
    emits: ['rendered', 'error'],
    setup(props, { emit }) {
        let pdfDocument = null;
        let firstPageSize = null;
        let loadingTask = null;
        let managedObjectUrl = null;
        let resizeObserver = null;
        let documentVersion = 0;
        let layoutVersion = 0;
        let hasEmittedRendered = false;
        let isUnmounted = false;

        const containerRef = ref(null);
        const wrapperRef = ref(null);
        const numPages = ref(0);
        const currentPage = ref(1);
        const userScale = ref(
            resolvePositiveNumber(props.options?.defaultScale) ??
            resolvePositiveNumber(props.defaultScale) ??
            1
        );
        const userRotation = ref(0);

        let totalItems = 0;
        let baseFitScale = 1;
        let pageMetrics = [];
        let pageTops = [];
        let lastObservedWidth = 0;
        let pageJump = null;
        let scrollFrame = 0;
        const mountedPages = new Map();
        const measuredPageSizes = new Map();

        function revokeManagedObjectUrl() {
            if (managedObjectUrl) {
                URL.revokeObjectURL(managedObjectUrl);
                managedObjectUrl = null;
            }
        }

        function resolveDocumentUrl(src) {
            if (typeof src === 'string') {
                return src;
            }
            if (src instanceof Blob) {
                managedObjectUrl = URL.createObjectURL(src);
                return managedObjectUrl;
            }
            if (src instanceof ArrayBuffer) {
                managedObjectUrl = URL.createObjectURL(new Blob([src], { type: 'application/pdf' }));
                return managedObjectUrl;
            }
            return src;
        }

        function getGap() {
            return typeof props.options?.gap === 'number' && Number.isFinite(props.options.gap)
                ? props.options.gap
                : 10;
        }

        function getWrapperPaddingTop() {
            if (!wrapperRef.value) {
                return 0;
            }
            return parseInt(getComputedStyle(wrapperRef.value).paddingTop, 10) || 0;
        }

        function getContentWidth() {
            const container = containerRef.value;
            const { paddingLeft, paddingRight } = getComputedStyle(container);
            return container.clientWidth - (parseFloat(paddingLeft) || 0) - (parseFloat(paddingRight) || 0);
        }

        function getPageViewport(pdfPage, scale) {
            if (userRotation.value === 0) {
                return pdfPage.getViewport({ scale });
            }
            return pdfPage.getViewport({ scale, rotation: (pdfPage.rotate + userRotation.value) % 360 });
        }

        function getRotatedSize(baseSize, scale) {
            const swapped = userRotation.value % 180 !== 0;
            return {
                width: (swapped ? baseSize.height : baseSize.width) * scale,
                height: (swapped ? baseSize.width : baseSize.height) * scale
            };
        }

        function cancelRender(entry) {
            if (!entry.task) {
                return;
            }
            entry.task.cancel();
            entry.task = null;
        }

        function disposeMountedPage(pageNumber) {
            const entry = mountedPages.get(pageNumber);
            if (!entry) {
                return;
            }
            mountedPages.delete(pageNumber);
            cancelRender(entry);
            entry.canvas.width = 0;
            entry.canvas.height = 0;
            entry.canvas.remove();
            entry.page?.cleanup();
            entry.page = null;
        }

        function clearMountedPages() {
            for (const pageNumber of [...mountedPages.keys()]) {
                disposeMountedPage(pageNumber);
            }
            if (wrapperRef.value) {
                wrapperRef.value.innerHTML = '';
            }
        }

        function destroyActiveLoadingTask() {
            if (!loadingTask) {
                return;
            }
            const task = loadingTask;
            loadingTask = null;
            task.destroy().catch(() => {});
        }

        function destroyActiveDocument() {
            if (!pdfDocument) {
                return;
            }
            const doc = pdfDocument;
            pdfDocument = null;
            firstPageSize = null;
            measuredPageSizes.clear();
            doc.destroy().catch(() => {});
        }

        function rebuildPageOffsets() {
            const gap = getGap();
            pageTops = new Array(totalItems);
            let top = 0;
            let widest = 0;
            for (let i = 0; i < totalItems; i += 1) {
                pageTops[i] = top;
                const metric = pageMetrics[i];
                top += metric.height + gap;
                if (metric.width > widest) {
                    widest = metric.width;
                }
            }
            if (wrapperRef.value) {
                wrapperRef.value.style.height = `${Math.max(0, top - gap)}px`;
                const contentWidth = getContentWidth();
                wrapperRef.value.style.width =
                    contentWidth > 0 && widest > contentWidth
                        ? `${widest + 20}px`
                        : '100%';
            }
        }

        function repositionMountedCanvases() {
            const paddingTop = getWrapperPaddingTop();
            for (const [pageNumber, entry] of mountedPages.entries()) {
                const metric = pageMetrics[pageNumber - 1];
                entry.canvas.style.top = `${pageTops[pageNumber - 1] + paddingTop}px`;
                entry.canvas.style.width = `${metric.width}px`;
                entry.canvas.style.height = `${metric.height}px`;
            }
        }

        function findPageAtOffset(offset) {
            if (totalItems <= 1) {
                return 1;
            }
            const gap = getGap();
            let low = 0;
            let high = totalItems - 1;
            while (low <= high) {
                const mid = (low + high) >> 1;
                const top = pageTops[mid];
                const bottom = top + pageMetrics[mid].height + gap;
                if (offset < top) {
                    high = mid - 1;
                } else if (offset >= bottom) {
                    low = mid + 1;
                } else {
                    return mid + 1;
                }
            }
            return Math.min(totalItems, Math.max(1, low + 1));
        }

        function getViewport() {
            const container = containerRef.value;
            const bounds = container.getBoundingClientRect();
            const innerTop = bounds.top + container.clientTop;
            let top = 0;
            let bottom = window.innerHeight;
            const scrollTargets = [];
            for (let parent = container.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
                const overflow = getComputedStyle(parent).overflowY;
                if (!overflow || overflow === 'visible') {
                    continue;
                }
                const parentTop = parent.getBoundingClientRect().top + parent.clientTop;
                top = Math.max(top, parentTop);
                bottom = Math.min(bottom, parentTop + parent.clientHeight);
                if (
                    (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') &&
                    parent.scrollHeight > parent.clientHeight
                ) {
                    scrollTargets.push(parent);
                }
            }
            if (container.scrollHeight > container.clientHeight || bounds.height === 0) {
                scrollTargets.unshift(container);
            }
            scrollTargets.push(window);

            const scrollTarget = scrollTargets[0];
            const visibleTop = Math.max(top, innerTop);
            const contentTop = innerTop
                + (parseFloat(getComputedStyle(container).paddingTop) || 0)
                + getWrapperPaddingTop()
                - container.scrollTop;
            return {
                offset: visibleTop - contentTop,
                height: Math.max(0, Math.min(bottom, innerTop + container.clientHeight) - visibleTop),
                contentTop,
                scrollTarget,
                scrollTargets,
                scrollOffset: (scrollTarget === container ? visibleTop : top) - contentTop
            };
        }

        function scrollToOffset(offset, previousTarget) {
            const viewport = getViewport();
            const target = previousTarget === containerRef.value ? previousTarget : viewport.scrollTarget;
            scrollBy(target, offset - viewport.offset);
        }

        function scrollBy(target, delta) {
            if (delta === 0) {
                return;
            }
            if (typeof target.scrollBy === 'function') {
                try {
                    target.scrollBy({ top: delta, behavior: 'instant' });
                    return;
                } catch {
                    // Chromium < 109 and older browsers reject behavior: 'instant'.
                }
                if (target === window) {
                    target.scrollBy(0, delta);
                    return;
                }
            }
            if (target !== window) {
                target.scrollTop += delta;
            }
        }

        function alignPageJump() {
            const pageIndex = pageJump.page - 1;
            const pageTop = pageTops[pageIndex];
            const pageBottom = pageTop + pageMetrics[pageIndex].height;
            const initialViewport = getViewport();
            pageJump.target ??= initialViewport.scrollTarget;
            const primaryTarget = pageJump.target === containerRef.value ? pageJump.target : initialViewport.scrollTarget;
            scrollBy(primaryTarget, pageTop - initialViewport.scrollOffset);

            let viewport = getViewport();
            for (const target of initialViewport.scrollTargets.filter((item) => item !== primaryTarget)) {
                if (viewport.height > 0 && viewport.offset < pageBottom && viewport.offset + viewport.height > pageTop) {
                    break;
                }
                const top = target === window ? 0 : target.getBoundingClientRect().top + target.clientTop;
                const bottom = top + (target === window ? window.innerHeight : target.clientHeight);
                const leading = viewport.contentTop + pageTop - top;
                const trailing = viewport.contentTop + pageBottom - bottom;
                if (leading > 0 && trailing > 0) {
                    scrollBy(target, Math.min(leading, trailing));
                } else if (leading < 0 && trailing < 0) {
                    scrollBy(target, Math.max(leading, trailing));
                }
                viewport = getViewport();
            }
            pageJump.offset = viewport.offset;
        }

        function getVisibleRange({ offset, height }) {
            const relativeTop = Math.max(0, offset);

            if (height <= 0) {
                const start = findPageAtOffset(relativeTop);
                return [Math.max(1, start - 1), Math.min(totalItems, start + 5)];
            }

            const firstVisible = findPageAtOffset(relativeTop);
            const lastVisible = findPageAtOffset(Math.max(0, offset + height));
            return [
                Math.max(1, firstVisible - 2),
                Math.min(totalItems, lastVisible + 2)
            ];
        }

        function createCanvas(pageNumber) {
            const paddingTop = getWrapperPaddingTop();
            const metric = pageMetrics[pageNumber - 1];
            const canvas = document.createElement('canvas');
            canvas.style.position = 'absolute';
            canvas.style.top = `${pageTops[pageNumber - 1] + paddingTop}px`;
            canvas.style.left = '50%';
            canvas.style.transform = 'translateX(-50%)';
            canvas.style.backgroundColor = '#fff';
            canvas.setAttribute('data-id', String(pageNumber));
            canvas.style.width = `${metric.width}px`;
            canvas.style.height = `${metric.height}px`;
            return canvas;
        }

        async function renderPage(pageNumber, entry, activeDocVersion, activeLayoutVersion) {
            const isStale = () =>
                isUnmounted ||
                activeDocVersion !== documentVersion ||
                activeLayoutVersion !== layoutVersion ||
                mountedPages.get(pageNumber) !== entry;
            if (!pdfDocument || isStale()) {
                return;
            }
            let pdfPage;
            try {
                pdfPage = await pdfDocument.getPage(pageNumber);
            } catch (error) {
                if (isStale()) {
                    return;
                }
                throw error;
            }
            if (isStale()) {
                if (!mountedPages.has(pageNumber)) {
                    pdfPage.cleanup();
                }
                return;
            }
            entry.page = pdfPage;
            if (!measuredPageSizes.has(pageNumber)) {
                const unit = pdfPage.getViewport({ scale: 1 });
                measuredPageSizes.set(pageNumber, { width: unit.width, height: unit.height });
            }

            const renderScale = baseFitScale * userScale.value;
            const viewport = getPageViewport(pdfPage, renderScale);
            const domWidth = Math.max(1, Math.floor(viewport.width));
            const domHeight = Math.max(1, Math.floor(viewport.height));

            const metric = pageMetrics[pageNumber - 1];
            if (metric.width !== domWidth || metric.height !== domHeight) {
                const { offset, height, scrollTarget } = getViewport();
                const anchorIndex = findPageAtOffset(offset) - 1;
                const prevAnchorTop = pageTops[anchorIndex];
                pageMetrics[pageNumber - 1] = { width: domWidth, height: domHeight };
                rebuildPageOffsets();
                repositionMountedCanvases();

                if (pageJump) {
                    alignPageJump();
                } else if (height > 0 && pageTops[anchorIndex] !== prevAnchorTop) {
                    scrollToOffset(offset + pageTops[anchorIndex] - prevAnchorTop, scrollTarget);
                }
                renderVisiblePages();
                if (isStale()) {
                    return;
                }
            }

            const outputScale = Math.min(
                Math.min(window.devicePixelRatio, 2),
                Math.sqrt(MAX_CANVAS_PIXELS / (domWidth * domHeight)),
                MAX_CANVAS_DIMENSION / Math.max(domWidth, domHeight)
            );

            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(domWidth * outputScale));
            canvas.height = Math.max(1, Math.floor(domHeight * outputScale));

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('无法获取 PDF 画布的 2D 上下文');
            }

            const transform = outputScale !== 1
                ? [outputScale, 0, 0, outputScale, 0, 0]
                : null;

            const renderTask = pdfPage.render({
                canvasContext: ctx,
                transform,
                viewport
            });
            entry.task = renderTask;

            try {
                await renderTask.promise;
            } catch (error) {
                canvas.width = 0;
                canvas.height = 0;
                if (isRenderCancelled(error) || isStale()) {
                    return;
                }
                throw error;
            } finally {
                if (entry.task === renderTask) {
                    entry.task = null;
                }
            }
            if (isStale()) {
                canvas.width = 0;
                canvas.height = 0;
                return;
            }
            canvas.style.cssText = entry.canvas.style.cssText;
            canvas.setAttribute('data-id', String(pageNumber));
            entry.canvas.replaceWith(canvas);
            entry.canvas.width = 0;
            entry.canvas.height = 0;
            entry.canvas = canvas;
            entry.rendered = true;
            emitRenderedIfReady();
        }

        function emitRenderedIfReady() {
            if (hasEmittedRendered || mountedPages.size === 0) {
                return;
            }
            for (const entry of mountedPages.values()) {
                if (!entry.rendered) {
                    return;
                }
            }
            hasEmittedRendered = true;
            emit('rendered');
        }

        function renderVisiblePages() {
            if (!wrapperRef.value || !firstPageSize) {
                return;
            }
            const viewport = getViewport();
            const [startIndex, endIndex] = getVisibleRange(viewport);
            const activeDocVersion = documentVersion;
            const activeLayoutVersion = layoutVersion;

            for (const pageNumber of [...mountedPages.keys()]) {
                if (pageNumber < startIndex || pageNumber > endIndex) {
                    disposeMountedPage(pageNumber);
                }
            }

            const tasks = [];
            for (let pageNumber = startIndex; pageNumber <= endIndex; pageNumber += 1) {
                let entry = mountedPages.get(pageNumber);
                if (entry?.layoutVersion === activeLayoutVersion) {
                    continue;
                }
                if (entry) {
                    cancelRender(entry);
                    entry.rendered = false;
                    entry.layoutVersion = activeLayoutVersion;
                } else {
                    entry = {
                        canvas: createCanvas(pageNumber),
                        task: null,
                        page: null,
                        rendered: false,
                        layoutVersion: activeLayoutVersion
                    };
                    mountedPages.set(pageNumber, entry);
                    wrapperRef.value.appendChild(entry.canvas);
                }
                tasks.push(renderPage(pageNumber, entry, activeDocVersion, activeLayoutVersion));
            }

            if (tasks.length > 0) {
                Promise.all(tasks).catch((error) => {
                    if (
                        isRenderCancelled(error) ||
                        isUnmounted ||
                        activeDocVersion !== documentVersion ||
                        activeLayoutVersion !== layoutVersion
                    ) {
                        return;
                    }
                    emit('error', error);
                });
            }
            if (!pageJump) {
                currentPage.value = findPageAtOffset(Math.max(0, viewport.offset + viewport.height * 0.35));
            }
            emitRenderedIfReady();
        }

        function relayoutAndRender({ preserveScroll = false } = {}) {
            if (!firstPageSize || isUnmounted || !wrapperRef.value || !containerRef.value) {
                return;
            }

            layoutVersion += 1;
            const previousViewport = preserveScroll ? getViewport() : null;
            const anchorIndex = previousViewport ? findPageAtOffset(previousViewport.offset) - 1 : 0;
            const anchorRatio = previousViewport
                ? (previousViewport.offset - pageTops[anchorIndex]) / pageMetrics[anchorIndex].height
                : 0;

            const unitViewport = getRotatedSize(firstPageSize, 1);
            const containerWidth = getContentWidth();
            lastObservedWidth = containerWidth;

            const explicitWidth = resolvePositiveNumber(props.options?.width);
            if (explicitWidth) {
                baseFitScale = explicitWidth / Math.max(unitViewport.width, 1);
            } else if (containerWidth > 20) {
                baseFitScale = Math.min((containerWidth - 20) / Math.max(unitViewport.width, 1), 2);
            } else {
                baseFitScale = 1;
            }

            const renderScale = baseFitScale * userScale.value;
            const firstViewport = getRotatedSize(firstPageSize, renderScale);
            pageMetrics = Array.from({ length: totalItems }, (_, index) => {
                const pageSize = measuredPageSizes.get(index + 1);
                const viewport = pageSize ? getRotatedSize(pageSize, renderScale) : firstViewport;
                return {
                    width: Math.max(1, Math.floor(viewport.width)),
                    height: Math.max(1, Math.floor(viewport.height))
                };
            });
            rebuildPageOffsets();
            repositionMountedCanvases();

            if (pageJump) {
                alignPageJump();
            } else if (previousViewport?.height > 0 || previousViewport?.scrollTarget === containerRef.value) {
                const offset = previousViewport.offset <= 0
                    ? previousViewport.offset
                    : pageTops[anchorIndex] + pageMetrics[anchorIndex].height * anchorRatio;
                scrollToOffset(offset, previousViewport.scrollTarget);
            } else if (!preserveScroll) {
                containerRef.value.scrollTop = 0;
            }

            renderVisiblePages();
        }

        async function init() {
            const activeDocVersion = ++documentVersion;
            layoutVersion += 1;
            hasEmittedRendered = false;

            onResizePdf.cancel();
            clearMountedPages();
            if (wrapperRef.value) {
                wrapperRef.value.style.height = '';
                wrapperRef.value.style.width = '';
            }
            if (containerRef.value) {
                containerRef.value.scrollTop = 0;
                containerRef.value.scrollLeft = 0;
            }
            destroyActiveLoadingTask();
            destroyActiveDocument();
            revokeManagedObjectUrl();

            numPages.value = 0;
            currentPage.value = 1;
            pageJump = null;
            totalItems = 0;
            pageMetrics = [];
            pageTops = [];

            if (!props.src) {
                emit('error', new Error('src不能为空'));
                return;
            }

            let pdfjsLib;
            try {
                pdfjsLib = await loadPdfjsLib();
            } catch (error) {
                if (!isUnmounted && activeDocVersion === documentVersion) {
                    emit('error', error);
                }
                return;
            }

            if (isUnmounted || activeDocVersion !== documentVersion) {
                return;
            }

            const { width: _ignoredWidth, ...extraOptions } = props.options || {};
            const baseDocumentOptions = {
                url: resolveDocumentUrl(props.src),
                withCredentials: props.requestOptions && props.requestOptions.withCredentials,
                cMapPacked: true,
                enableXfa: true
            };

            if (props.staticFileUrl) {
                const normalizedStaticUrl = props.staticFileUrl.endsWith('/')
                    ? props.staticFileUrl
                    : `${props.staticFileUrl}/`;
                baseDocumentOptions.cMapUrl = `${normalizedStaticUrl}cmaps/`;
            }

            let task;
            try {
                task = pdfjsLib.getDocument(createDocumentOptions({
                    ...baseDocumentOptions,
                    ...extraOptions
                }));
                loadingTask = task;
                const pdf = await task.promise;
                if (isUnmounted || activeDocVersion !== documentVersion) {
                    pdf.destroy().catch(() => {});
                    return;
                }
                if (loadingTask === task) {
                    loadingTask = null;
                }
                pdfDocument = pdf;
                if (pdf.numPages === 0) {
                    hasEmittedRendered = true;
                    emit('rendered');
                    return;
                }

                const page = await pdf.getPage(1);
                if (isUnmounted || activeDocVersion !== documentVersion) {
                    return;
                }
                const unit = page.getViewport({ scale: 1 });
                firstPageSize = { width: unit.width, height: unit.height };
                measuredPageSizes.set(1, firstPageSize);
                totalItems = pdf.numPages;
                relayoutAndRender();
                numPages.value = totalItems;
            } catch (error) {
                if (loadingTask === task) {
                    destroyActiveLoadingTask();
                }
                if (activeDocVersion === documentVersion) {
                    destroyActiveDocument();
                    revokeManagedObjectUrl();
                }
                if (!isUnmounted && activeDocVersion === documentVersion) {
                    emit('error', error);
                }
            }
        }

        function onScrollPdf() {
            if (scrollFrame) {
                return;
            }
            scrollFrame = requestAnimationFrame(() => {
                scrollFrame = 0;
                if (!isUnmounted && firstPageSize) {
                    renderVisiblePages();
                }
            });
        }

        function handleScroll() {
            if (pageJump && Math.abs(getViewport().offset - pageJump.offset) > 1) {
                pageJump = null;
            }
            onScrollPdf();
        }

        function handleAncestorScroll({ target }) {
            if (
                target === window ||
                target === document ||
                (target instanceof Element && target !== containerRef.value && target.contains(containerRef.value))
            ) {
                handleScroll();
            }
        }

        const onResizePdf = createDebounce(() => {
            if (isUnmounted || !firstPageSize || !containerRef.value) {
                return;
            }
            const nextWidth = getContentWidth();
            if (
                nextWidth > 20 &&
                (lastObservedWidth <= 20 || Math.abs(nextWidth - lastObservedWidth) > RESIZE_WIDTH_THRESHOLD)
            ) {
                if (!resolvePositiveNumber(props.options?.width)) {
                    relayoutAndRender({ preserveScroll: true });
                    return;
                }
                lastObservedWidth = nextWidth;
                rebuildPageOffsets();
            }
            renderVisiblePages();
        }, 120);

        function getScale() {
            return userScale;
        }

        function setScale(scale) {
            const nextScale = resolvePositiveNumber(scale);
            if (nextScale === null || nextScale === userScale.value) {
                return;
            }
            userScale.value = nextScale;
            relayoutAndRender({ preserveScroll: true });
        }

        function getRotation() {
            return userRotation;
        }

        function setRotation(deg) {
            const nextRotation = normalizeRotation(deg);
            if (nextRotation === null || nextRotation === userRotation.value) {
                return;
            }
            userRotation.value = nextRotation;
            clearMountedPages();
            relayoutAndRender({ preserveScroll: true });
        }

        function scrollToPage(page) {
            if (!firstPageSize || !containerRef.value || !Number.isFinite(page)) {
                return;
            }
            const targetPage = Math.min(totalItems, Math.max(1, Math.trunc(page)));
            pageJump = { page: targetPage, offset: 0, target: null };
            alignPageJump();
            currentPage.value = targetPage;
            renderVisiblePages();
        }

        function rerender() {
            relayoutAndRender({ preserveScroll: true });
        }

        function save(fileName) {
            const doc = pdfDocument;
            doc?.getData().then((fileData) => {
                const blob = new Blob([fileData], { type: 'application/pdf' });
                const objectUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.download = fileName || `vue-office-pdf-${Date.now()}.pdf`;
                link.style.display = 'none';
                link.href = objectUrl;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            }).catch((error) => {
                if (doc === pdfDocument) {
                    emit('error', error);
                }
            });
        }

        onMounted(() => {
            window.addEventListener('scroll', handleAncestorScroll, { capture: true, passive: true });
            window.addEventListener('resize', onResizePdf);
            resizeObserver = new ResizeObserver(() => {
                onResizePdf();
            });
            resizeObserver.observe(containerRef.value);
            for (let parent = containerRef.value.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
                const overflow = getComputedStyle(parent).overflowY;
                if (overflow && overflow !== 'visible') {
                    resizeObserver.observe(parent);
                }
            }
            if (props.src) {
                init().catch((e) => emit('error', e));
            }
        });

        watch(() => props.src, () => {
            init().catch((e) => emit('error', e));
        });

        onBeforeUnmount(() => {
            isUnmounted = true;
            documentVersion += 1;
            layoutVersion += 1;
            cancelAnimationFrame(scrollFrame);
            onResizePdf.cancel();
            window.removeEventListener('scroll', handleAncestorScroll, true);
            window.removeEventListener('resize', onResizePdf);
            resizeObserver?.disconnect();
            resizeObserver = null;
            clearMountedPages();
            destroyActiveLoadingTask();
            destroyActiveDocument();
            revokeManagedObjectUrl();
        });

        return {
            containerRef,
            wrapperRef,
            numPages,
            currentPage,
            save,
            onScrollPdf,
            handleScroll,
            rerender,
            userScale,
            getScale,
            setScale,
            rotation: userRotation,
            getRotation,
            setRotation,
            scrollToPage
        };
    }
});
</script>

<template>
    <div
        class="vue-office-pdf"
        ref="containerRef"
        style="text-align: center; overflow: auto; overflow-anchor: none; position: relative;"
        @scroll="handleScroll"
    >
        <div
            ref="wrapperRef"
            class="vue-office-pdf-wrapper"
            style="background: var(--vue-office-pdf-bg, #f2f3f5); padding: 30px 0; position: relative; box-sizing: content-box; min-width: 100%;"
        ></div>
        <slot></slot>
    </div>
</template>

<style lang="less">
</style>
