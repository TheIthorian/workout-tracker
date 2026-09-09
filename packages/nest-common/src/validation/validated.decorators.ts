import { Body, Param, Query, type PipeTransform } from '@nestjs/common';
import { EntityNotFoundError, RequestValidationError } from '@app/errors';
import type { ZodType } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/** `@ValidatedBody(schema)` - the replacement for `.WithBodyValidation<T>()`. */
export function ValidatedBody<T>(schema: ZodType<T>): ParameterDecorator {
    return Body(new ZodValidationPipe(schema));
}

/** `@ValidatedParam({ name, schema })` - the replacement for a `{id:guid}` route constraint. */
export function ValidatedParam<T>({ name, schema }: { name: string; schema: ZodType<T> }): ParameterDecorator {
    return Param(name, new ValidatedParamPipe(schema));
}

/** `@ValidatedQuery(schema)` - for pagination and filter query objects. */
export function ValidatedQuery<T>(schema: ZodType<T>): ParameterDecorator {
    return Query(new ZodValidationPipe(schema));
}

/**
 * Validates a path parameter, reporting a malformed one as 404 rather than 400.
 *
 * A path segment that cannot be a valid id names no resource, so "not found" is the honest answer,
 * and it keeps a malformed id indistinguishable from one the caller may not see. A plain 400 would
 * also let a scanner tell "wrong shape" apart from "no such row".
 */
export class ValidatedParamPipe<T> implements PipeTransform<unknown, T> {
    private readonly pipe: ZodValidationPipe<T>;

    constructor(schema: ZodType<T>) {
        this.pipe = new ZodValidationPipe(schema);
    }

    /** Parses `value`, translating a validation failure into a 404 rather than a 400. */
    transform(value: unknown): T {
        try {
            return this.pipe.transform(value);
        } catch (error) {
            if (error instanceof RequestValidationError) throw new EntityNotFoundError('Not found');

            throw error;
        }
    }
}
