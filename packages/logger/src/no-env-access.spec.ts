import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * The boundary this package is meant to hold. A library that reads `process.env` cannot be
 * constructed twice with different settings, cannot be tested against a value it was not started
 * with, and gives the owning app a second source of truth it does not know it has.
 */
describe('package source', () => {
    it('never reads process.env', () => {
        const root = __dirname;

        const offenders = sourceFiles(root)
            .filter((file) => !file.endsWith('.spec.ts'))
            .filter((file) => withoutComments(readFileSync(file, 'utf8')).includes('process.env'))
            .map((file) => relative(root, file));

        expect(offenders).toEqual([]);
    });
});

// Comments discuss the rule, so only code counts. Naive but sufficient: no string literal in this
// package contains a comment opener.
function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);

        if (statSync(path).isDirectory()) return sourceFiles(path);

        return path.endsWith('.ts') ? [path] : [];
    });
}
