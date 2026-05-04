import { svelte } from '@sveltejs/vite-plugin-svelte';
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';

const androidApk = resolve(__dirname, '../android/app/build/outputs/apk/debug/app-debug.apk');
const distApk = resolve(__dirname, 'dist/tr.apk');
const skipAndroidApk = process.env.TODDLER_READ_SKIP_APK === '1';

export default defineConfig({
  plugins: [
    svelte(),
    {
      name: 'copy-android-apk',
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
      },
      closeBundle() {
        if (!existsSync(androidApk)) {
          if (skipAndroidApk) {
            console.warn(`Skipping Android APK copy because TODDLER_READ_SKIP_APK=1.`);
            return;
          }

          throw new Error(`Android APK not found at ${androidApk}. Run npm run android:build first.`);
        }

        mkdirSync(dirname(distApk), { recursive: true });
        copyFileSync(androidApk, distApk);
      }
    }
  ]
});
