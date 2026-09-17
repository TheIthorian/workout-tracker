// Brings `vitest` into the program so the augmentation below has a module to attach to, without
// importing anything at runtime.
import type {} from 'vitest';

/** What `startTestDatabase` needs to clone itself a database out of the run's shared server. */
export type TestDatabaseTemplate = {
    adminConnectionString: string;
    templateDatabase: string;
};

/** Lets a setup file's `inject('testDatabaseTemplate')` type-check against what `setup` provides. */
declare module 'vitest' {
    export interface ProvidedContext {
        testDatabaseTemplate?: TestDatabaseTemplate;
    }
}

let template: TestDatabaseTemplate | undefined;

/**
 * Hands the fixture the template `global-setup.ts` prepared for this run. A vitest setup file calls
 * this once per worker with `inject('testDatabaseTemplate')`; the value crosses the process boundary
 * through vitest rather than through this package, which reads no ambient state of its own.
 */
export function useTestDatabaseTemplate({ template: provided }: { template: TestDatabaseTemplate | undefined }): void {
    template = provided;
}

/** The template for this run, or `undefined` when nothing was provided. */
export function testDatabaseTemplate(): TestDatabaseTemplate | undefined {
    return template;
}
