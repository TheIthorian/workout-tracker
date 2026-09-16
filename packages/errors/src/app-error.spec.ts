import { describe, expect, it } from 'vitest';
import {
    AppError,
    ConfigurationError,
    ConflictError,
    EntityNotFoundError,
    ForbiddenActionError,
    ImageTooLargeError,
    InvalidFormatError,
    InvalidOperationError,
    PROBLEM_TYPE_BASE,
    RequestValidationError,
    TooManyRequestsError,
    UnauthorizedError,
    UserAlreadyMemberError,
} from './index.js';

describe('AppError', () => {
    it('is an Error and keeps its subclass name', () => {
        const error = new UnauthorizedError();

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(AppError);
        expect(error.name).toBe('UnauthorizedError');
    });

    it('exposes the problem status as statusCode', () => {
        expect(new UnauthorizedError().statusCode).toBe(401);
    });
});

describe('problem bodies', () => {
    it('builds the Unauthorized problem body', () => {
        expect(new UnauthorizedError().problem).toEqual({
            type: `${PROBLEM_TYPE_BASE}/UnauthorizedError`,
            title: 'Unauthorized',
            status: 401,
        });
    });

    it('builds the InvalidFormat problem body with a detail', () => {
        expect(new InvalidFormatError('Bad image', 'Only PNG and JPEG are supported').problem).toEqual({
            type: `${PROBLEM_TYPE_BASE}/InvalidFormatError`,
            title: 'Bad image',
            status: 400,
            detail: 'Only PNG and JPEG are supported',
        });
    });

    it('omits detail entirely when none is given', () => {
        const { problem } = new InvalidFormatError('Bad image');

        expect(problem).toEqual({
            type: `${PROBLEM_TYPE_BASE}/InvalidFormatError`,
            title: 'Bad image',
            status: 400,
        });
        expect('detail' in problem).toBe(false);
    });

    it('builds the ImageTooLarge problem body as 413', () => {
        expect(new ImageTooLargeError('Image is 7000x10 px; neither side may exceed 6000').problem).toEqual({
            type: `${PROBLEM_TYPE_BASE}/ImageTooLargeError`,
            title: 'Image is too large',
            status: 413,
            detail: 'Image is 7000x10 px; neither side may exceed 6000',
        });
    });

    it('builds the RequestValidation problem body with an errors dictionary', () => {
        const errors = {
            name: ['Name is required'],
            quantity: ['Must be at least 1'],
        };

        expect(new RequestValidationError(errors).problem).toEqual({
            type: `${PROBLEM_TYPE_BASE}/RequestValidationError`,
            title: 'Request validation failed',
            status: 400,
            detail: 'One or more validation errors occurred.',
            errors,
        });
    });

    it('copies the errors dictionary so later mutation cannot leak in', () => {
        const errors = { name: ['Name is required'] };
        const error = new RequestValidationError(errors);

        errors.name.push('mutated');

        expect(error.problem.errors).toEqual({ name: ['Name is required'] });
    });

    it('builds the ForbiddenAction problem body', () => {
        expect(new ForbiddenActionError('Not allowed', 'You do not own this resource').problem).toEqual({
            type: `${PROBLEM_TYPE_BASE}/ForbiddenActionError`,
            title: 'Not allowed',
            status: 403,
            detail: 'You do not own this resource',
        });
    });

    it('builds the EntityNotFound problem body', () => {
        expect(new EntityNotFoundError('Exercise not found', 'No exercise with that id').problem).toEqual({
            type: `${PROBLEM_TYPE_BASE}/EntityNotFoundError`,
            title: 'Exercise not found',
            status: 404,
            detail: 'No exercise with that id',
        });
    });

    it('builds the UserAlreadyMember problem body', () => {
        expect(new UserAlreadyMemberError().problem).toEqual({
            type: `${PROBLEM_TYPE_BASE}/UserAlreadyMemberError`,
            title: 'User already member',
            status: 400,
            detail: 'Cannot add member to workspace they are already member of',
        });
    });

    it('builds the TooManyRequests problem body', () => {
        expect(new TooManyRequestsError('Too many attempts', 'Try again in 15 minutes').problem).toEqual({
            type: `${PROBLEM_TYPE_BASE}/TooManyRequestsError`,
            title: 'Too many attempts',
            status: 429,
            detail: 'Try again in 15 minutes',
        });
    });

    it('builds the Conflict problem body', () => {
        expect(new ConflictError('Already exists', 'A user already exists with that email').problem).toEqual({
            type: `${PROBLEM_TYPE_BASE}/ConflictError`,
            title: 'Already exists',
            status: 409,
            detail: 'A user already exists with that email',
        });
    });

    it('builds the InvalidOperation problem body', () => {
        expect(new InvalidOperationError('Cannot delete the last owner').problem).toEqual({
            type: `${PROBLEM_TYPE_BASE}/InvalidOperationError`,
            title: 'Cannot delete the last owner',
            status: 400,
        });
    });

    it('builds the InvalidOperation problem body with a detail', () => {
        expect(
            new InvalidOperationError('Cannot edit your own role', 'Ask another admin to change it').problem,
        ).toEqual({
            type: `${PROBLEM_TYPE_BASE}/InvalidOperationError`,
            title: 'Cannot edit your own role',
            status: 400,
            detail: 'Ask another admin to change it',
        });
    });

    it('builds the Configuration problem body', () => {
        expect(new ConfigurationError('DATABASE_URL is missing').problem).toEqual({
            type: `${PROBLEM_TYPE_BASE}/ConfigurationError`,
            title: 'DATABASE_URL is missing',
            status: 500,
        });
    });
});
