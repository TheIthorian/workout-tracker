import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globalSetup: ['./vitest.global-setup.ts'],
        setupFiles: ['./vitest.setup.ts'],
        include: ['src/**/*.spec.ts'],
        testTimeout: 60_000,
        hookTimeout: 60_000,
    },
});
