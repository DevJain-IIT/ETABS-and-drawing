'use client';
import React from 'react';

export interface PdfBitmap {
  bitmap: ImageBitmap;
  pageW: number; // PDF page width in pts
  pageH: number; // PDF page height in pts
  renderedScale: number; // the view scale this bitmap was rendered at
}

// Renders a PDF page into an ImageBitmap exactly matched to the current view scale,
// so text and lines are always crisp regardless of zoom level.
//
// viewScale: the canvas px-per-PDF-pt scale from the current View. Pass 0 before
//   the view is initialised — the hook will render at a sensible default and update
//   once a real scale arrives.
//
// Re-renders are debounced (300 ms) so rapid zoom scrolling doesn't thrash PDF.js.
export function usePdfBitmap(
  url: string | null,
  viewScale: number,
): PdfBitmap | null {
  const [result, setResult] = React.useState<PdfBitmap | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  // Debounce: only fire a render when the scale has settled
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // We keep a ref to the latest requested scale so the debounced callback
  // always picks up the most recent value, not a stale closure.
  const pendingScale = React.useRef(viewScale);
  pendingScale.current = viewScale;

  React.useEffect(() => {
    if (!url) { setResult(null); return; }

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      const scale = pendingScale.current;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      (async () => {
        try {
          const pdfjsLib = await import('pdfjs-dist');
          if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
              new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
          }

          const loadingTask = pdfjsLib.getDocument({ url, disableStream: false });
          ac.signal.addEventListener('abort', () => loadingTask.destroy());
          const pdf = await loadingTask.promise;
          if (ac.signal.aborted) return;

          const page = await pdf.getPage(1);
          if (ac.signal.aborted) { page.cleanup(); return; }

          const vp0 = page.getViewport({ scale: 1 });
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

          // Render at the exact view scale × device pixel ratio so every screen pixel
          // maps to a rendered PDF pixel — text stays sharp at any zoom level.
          // Use a minimum of 2 pt-per-px so the initial (unzoomed) render isn't tiny.
          const renderScale = Math.max(scale, 2) * dpr;

          const vp = page.getViewport({ scale: renderScale });
          const offscreen = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ctx = offscreen.getContext('2d') as any;

          await page.render({
            canvasContext: ctx,
            viewport: vp,
            canvas: offscreen as unknown as HTMLCanvasElement,
          }).promise;
          if (ac.signal.aborted) { page.cleanup(); return; }

          const bitmap = await createImageBitmap(offscreen);
          page.cleanup();

          if (!ac.signal.aborted) {
            setResult({ bitmap, pageW: vp0.width, pageH: vp0.height, renderedScale: renderScale });
          }
        } catch (e) {
          if (!ac.signal.aborted) console.error('[usePdfBitmap]', e);
        }
      })();
    }, 300); // debounce — only re-render after zoom settles

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [url, viewScale]);

  return result;
}
