import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import fs from 'fs';
import type { Plugin } from 'vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const apiProxyTarget = env.VITE_API_PROXY_TARGET || env.VITE_API_BASE_URL || 'http://127.0.0.1:3000';
    const siteOrigin = (env.VITE_SITE_URL || readWranglerVar('VITE_SITE_URL')).replace(/\/+$/, '');

    return {
        server: {
            host: '::',
            port: 8080,
            // Same-origin /api in dev — avoids cross-port CORS and HTTPS redirects to the API.
            proxy: {
                '/api': {
                    target: apiProxyTarget,
                    changeOrigin: true,
                },
            },
        },
        build: {
            // Vite's default ('modules') still targets Safari 14, which costs downlevelling and
            // shipped polyfills for syntax every browser we support has had for years — Lighthouse
            // flagged 8 KiB of them. es2022 is baseline-available across current browsers.
            target: 'es2022',

            // Emitted alongside the bundle but not referenced by it, so stack traces from
            // production can be symbolicated without serving maps to visitors. Lighthouse's
            // valid-source-maps audit was failing outright.
            sourcemap: 'hidden',

            rollupOptions: {
                output: {
                    // Dependencies change far less often than app code, so keeping them in their
                    // own chunks means a UI deploy doesn't invalidate them in the browser cache.
                    manualChunks: {
                        react: ['react', 'react-dom', 'react-router-dom'],
                        query: ['@tanstack/react-query'],
                        motion: ['framer-motion'],
                        analytics: ['posthog-js', '@posthog/react'],
                        http: ['axios'],
                    },
                },
            },
        },
        plugins: [react(), siteOriginHtmlPlugin({ siteOrigin })],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
                '@app/domain': path.resolve(__dirname, '../../packages/domain/src/index.ts'),
            },
        },
    };
});

/**
 * Reads a `[vars]` entry out of wrangler.toml. Cloudflare Pages projects configured from a
 * wrangler.toml cannot also set build environment variables in the dashboard, so the build reads
 * the deployment's own origin from the same file the deployment is described in.
 */
function readWranglerVar(name: string): string {
    const wranglerPath = path.resolve(__dirname, './wrangler.toml');

    if (!fs.existsSync(wranglerPath)) {
        return '';
    }

    const match = fs.readFileSync(wranglerPath, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*["']([^"']*)["']`, 'm'));

    return match?.[1] ?? '';
}

/**
 * Resolves the `%SITE_ORIGIN%` placeholder the link/preview meta tags in index.html are written
 * against. Crawlers resolve relative URLs inconsistently, so a deployment that wants a link
 * preview sets VITE_SITE_URL — in its environment, or in wrangler.toml's `[vars]` — to its public
 * origin; unset, the tags fall back to same-origin paths.
 */
function siteOriginHtmlPlugin({ siteOrigin }: { siteOrigin: string }): Plugin {
    return {
        name: 'forma-site-origin-html',
        transformIndexHtml: {
            order: 'pre',
            handler(html: string): string {
                return html.replaceAll('%SITE_ORIGIN%', siteOrigin);
            },
        },
    };
}
