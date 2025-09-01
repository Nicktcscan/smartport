// src/utils/pdfUtils.js
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf';

/**
 * Initialize PDF.js worker dynamically as an ES module
 */
function initPdfWorker() {
  if (typeof window !== 'undefined') {
    // Only initialize once
    if (!GlobalWorkerOptions.workerSrc) {
      // Create a new Worker from the ES module
      const worker = new Worker(
        new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url),
        { type: 'module' }
      );
      GlobalWorkerOptions.workerPort = worker;
    }
  }
}

/**
 * Convert first page of PDF to PNG using pdfjs
 */
export async function pdfPageToBlobPdfjs(file, scale = 2) {
  initPdfWorker();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d');

  await page.render({ canvasContext: context, viewport }).promise;

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PDF.js canvas to blob failed'));
    }, 'image/png', 1);
  });
}

/**
 * Convert all pages of a PDF to PNGs
 */
export async function pdfAllPagesToBlobs(file, scale = 2) {
  initPdfWorker();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  const blobs = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');

    await page.render({ canvasContext: context, viewport }).promise;

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PDF.js canvas to blob failed'))), 'image/png', 1);
    });

    blobs.push(blob);
  }

  return blobs;
}
