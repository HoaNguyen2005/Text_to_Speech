import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Share one worker source between book and lecture uploads. It is bundled with
// this installed PDF.js version, never loaded from an unrelated CDN version.
// A new URL also bypasses cached responses from before the Nginx MIME fix.
const workerSource = new URL(workerUrl, import.meta.url);
workerSource.searchParams.set('module', '1');
pdfjs.GlobalWorkerOptions.workerSrc = workerSource.href;

export default pdfjs;
