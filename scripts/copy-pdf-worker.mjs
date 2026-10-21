// Copies the PDF.js worker into /public so react-pdf can load it from the same origin.
// Never fails the install: if pdfjs-dist is missing, it logs and exits 0.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
const dest = resolve(root, 'public/pdf.worker.min.mjs');

if (!existsSync(src)) {
  console.warn('[copy-pdf-worker] pdfjs-dist worker not found; skipping.');
  process.exit(0);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log('[copy-pdf-worker] copied pdf.worker.min.mjs to public/');
