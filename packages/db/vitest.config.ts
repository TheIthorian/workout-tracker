import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globalSetup: ['./src/testing/global-setup.ts'],
        setupFiles: ['./vitest.setup.ts'],
        include: ['src/**/*.spec.ts'],
        testTimeout: 60_000,
        hookTimeout: 60_000,
    },
});
