import type { PipeTransform } from '@nestjs/common';
import { RequestValidationError } from '@app/errors';
import type { ZodType } from 'zod';

/**
 * Validates one handler argument against a schema from `@app/api-contract` and throws the
 * same `RequestValidationError` the rest of the stack uses, so `AppErrorFilter` produces the
 * `errors` dictionary the UI's `handleAxiosError` looks for.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
    constructor(private readonly schema: ZodType<T>) {}

    /** Parses `value` against the schema, throwing a field-keyed `RequestValidationError` on failure. */
    transform(value: unknown): T {
        const result = this.schema.safeParse(value);

        if (result.success) return result.data;

        const errors: Record<string, string[]> = {};
        for (const issue of result.error.issues) {
            // A top-level issue has an empty path; key it as "" rather than dropping it.
            const key = issue.path.join('.');
            (errors[key] ??= []).push(issue.message);
        }

        throw new RequestValidationError(errors);
    }
}
