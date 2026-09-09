import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotenv } from './load-dotenv.js';

const original = { ...process.env };

afterEach(() => {
    process.env = { ...original };
});

describe('loadDotenv', () => {
    it('does nothing under vitest, so a real .env can never reach the test suite', () => {
        // The suite runs against testcontainers and truncates tables. `test/harness.ts` assigns
        // every variable with `??=`, so a `.env`-provided DATABASE_URL would win over the
        // harness's and point the whole suite at a developer's live database.
        expect(process.env['VITEST']).toBe('true');

        expect(loadDotenv()).toBeUndefined();
    });

    it('leaves a variable the environment already set untouched', () => {
        // Proven against the real dotenv call rather than the vitest guard, which would otherwise
        // make this assertion vacuous.
        const root = mkdtempSync(join(tmpdir(), 'dotenv-app-'));
        try {
            writeFileSync(join(root, 'package.json'), '{}\n');
            writeFileSync(join(root, '.env'), 'ALREADY_SET=from-file\nNOT_SET=from-file\n');

            process.env['ALREADY_SET'] = 'from-environment';
            delete process.env['NOT_SET'];

            const { config } = require('dotenv') as typeof import('dotenv');
            config({ path: join(root, '.env'), override: false, quiet: true });

            expect(process.env['ALREADY_SET']).toBe('from-environment');
            expect(process.env['NOT_SET']).toBe('from-file');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
