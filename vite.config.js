import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Optional local HTTPS.
 *
 * Camera (getUserMedia) and Geolocation only work in a secure context, so a
 * real phone cannot use the dev server over plain http://<LAN-IP>.
 *
 * Point these env vars at a mkcert-generated certificate pair to serve HTTPS:
 *   PowerShell:  $env:HTTPS_KEY="certs\dev-key.pem"; $env:HTTPS_CERT="certs\dev-cert.pem"
 *   bash:        HTTPS_KEY=certs/dev-key.pem HTTPS_CERT=certs/dev-cert.pem npm run dev
 *
 * The certificate must be trusted by the phone (mkcert -install + installing the
 * root CA on the device), otherwise the page is still not a secure context.
 */
function localHttps() {
  const { HTTPS_KEY, HTTPS_CERT } = process.env;
  if (!HTTPS_KEY || !HTTPS_CERT) return undefined;
  try {
    return { key: readFileSync(HTTPS_KEY), cert: readFileSync(HTTPS_CERT) };
  } catch (error) {
    console.warn(`[vite] Ignoring HTTPS_KEY/HTTPS_CERT: ${error.message}`);
    return undefined;
  }
}

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
    https: localHttps(),
  },
  preview: {
    host: true,
    port: 4173,
    https: localHttps(),
  },
  // piexif-ts ships a legacy package.json (no "exports" map) -> pre-bundle it.
  optimizeDeps: {
    include: ['piexif-ts', 'exifr', 'idb-keyval', 'leaflet'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Image Coordinate',
        short_name: 'Coordinates',
        description:
          'Направи снимка с браузъра и виж GPS координатите, на които е направена.',
        lang: 'bg',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        // OSM tiles / Nominatim are runtime data -> never intercept them.
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
