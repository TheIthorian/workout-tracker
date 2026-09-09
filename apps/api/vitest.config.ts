import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: {
        include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
        // Testcontainers pulls an image and applies a 1249-line schema on first use.
        testTimeout: 120_000,
        hookTimeout: 180_000,
    },
});
