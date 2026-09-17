import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: {
        globalSetup: ['./vitest.global-setup.ts'],
        setupFiles: ['./vitest.setup.ts'],
        include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
        testTimeout: 60_000,
        hookTimeout: 60_000,
    },
});
