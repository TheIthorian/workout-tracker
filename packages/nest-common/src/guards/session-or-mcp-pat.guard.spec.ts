import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@app/errors';
import { SessionOrMcpPatGuard } from './session-or-mcp-pat.guard.js';

const pass = { canActivate: vi.fn().mockResolvedValue(true) };
const fail = { canActivate: vi.fn().mockRejectedValue(new UnauthorizedError()) };
const context = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) } as never;

describe('SessionOrMcpPatGuard', () => {
    it('passes when the session guard passes', async () => {
        const guard = new SessionOrMcpPatGuard(pass as never, fail as never);

        await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('falls back to the token guard when there is no session', async () => {
        const guard = new SessionOrMcpPatGuard(fail as never, pass as never);

        await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('rejects when neither credential is accepted', async () => {
        const guard = new SessionOrMcpPatGuard(fail as never, fail as never);

        await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedError);
    });
});
