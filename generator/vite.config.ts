import { svelte } from '@sveltejs/vite-plugin-svelte';
import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { defineConfig } from 'vite';

const androidApk = resolve(__dirname, '../android/app/build/outputs/apk/debug/app-debug.apk');
const distApk = resolve(__dirname, 'dist/tr.apk');
const readerSource = resolve(__dirname, '../reader');
const distReader = resolve(__dirname, 'dist/reader');
const skipAndroidApk = process.env.TODDLER_READ_SKIP_APK === '1';

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function sendReaderFile(requestPath: string, res: import('node:http').ServerResponse) {
  const urlPath = decodeURIComponent(requestPath.split('?')[0] ?? '');
  const relativePath = (urlPath.startsWith('/reader') ? urlPath.replace(/^\/reader\/?/, '') : urlPath.replace(/^\/+/, '')) || 'index.html';
  const filePath = normalize(resolve(readerSource, relativePath));

  if (filePath !== readerSource && !filePath.startsWith(readerSource + sep)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  const finalPath = existsSync(filePath) && statSync(filePath).isDirectory()
    ? join(filePath, 'index.html')
    : filePath;

  if (!existsSync(finalPath) || !statSync(finalPath).isFile()) {
    res.statusCode = 404;
    res.end('Reader file not found.');
    return;
  }

  res.setHeader('Content-Type', mimeTypes[extname(finalPath)] ?? 'application/octet-stream');
  createReadStream(finalPath).pipe(res);
}

export default defineConfig({
  plugins: [
    svelte(),
    {
      name: 'toddler-reader-distribution',
      configureServer(server) {
        server.middlewares.use('/tr.apk', (_req, res) => {
          if (!existsSync(androidApk)) {
            res.statusCode = 404;
            res.end('Android APK not found. Run npm run android:build first.');
            return;
          }

          const { size } = statSync(androidApk);
          res.setHeader('Content-Type', 'application/vnd.android.package-archive');
          res.setHeader('Content-Length', String(size));
          createReadStream(androidApk).pipe(res);
        });
        server.middlewares.use((req, res, next) => {
          const originalUrl = (req as typeof req & { originalUrl?: string }).originalUrl ?? req.url ?? '';
          if (originalUrl === '/reader') {
            res.statusCode = 308;
            res.setHeader('Location', '/reader/');
            res.end();
            return;
          }

          if (originalUrl.startsWith('/reader/')) {
            sendReaderFile(originalUrl, res);
            return;
          }

          next();
        });
      },
      closeBundle() {
        if (!existsSync(androidApk)) {
          if (skipAndroidApk) {
            console.warn(`Skipping Android APK copy because TODDLER_READ_SKIP_APK=1.`);
          } else {
            throw new Error(`Android APK not found at ${androidApk}. Run npm run android:build first.`);
          }
        } else {
          mkdirSync(dirname(distApk), { recursive: true });
          copyFileSync(androidApk, distApk);
        }

        rmSync(distReader, { force: true, recursive: true });
        cpSync(readerSource, distReader, { recursive: true });
      }
    }
  ]
});
