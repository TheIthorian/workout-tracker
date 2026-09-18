// @vitest-environment jsdom
import { act, render, waitFor, within } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, AuthStatus, useAuth } from './AuthContext';
import type { UserResponse } from '@/models/user';

const getMe = vi.fn();

vi.mock('@/lib/api', () => ({
    authApi: {
        getMe: () => getMe(),
        login: vi.fn(),
        logout: vi.fn(),
        register: vi.fn(),
    },
}));

/**
 * The session survives a failed `/me` unless the API actually said 401.
 *
 * `ProtectedRoute` redirects on a missing user, so clearing the user on a dropped connection is
 * indistinguishable from being signed out: a phone that loses signal between sets lands on the
 * sign-in page with a session that was valid the whole time.
 */
describe('AuthProvider', () => {
    beforeEach(() => {
        getMe.mockReset();
    });

    it('signs the visitor in when /me returns a user', async () => {
        getMe.mockResolvedValue(buildUser());

        const probe = renderProvider();

        await waitFor(() => expect(probe.status()).toBe(AuthStatus.Authenticated));
        expect(probe.userId()).toBe('user-1');
    });

    it('signs the visitor out only when /me answers 401', async () => {
        getMe.mockRejectedValue(httpError(401));

        const probe = renderProvider();

        await waitFor(() => expect(probe.status()).toBe(AuthStatus.SignedOut));
        expect(probe.userId()).toBe('none');
    });

    it('reports an unreachable API rather than a sign-out when the request never lands', async () => {
        getMe.mockRejectedValue(new AxiosError('Network Error'));

        const probe = renderProvider();

        await waitFor(() => expect(probe.status()).toBe(AuthStatus.Unreachable));
    });

    it('reports an unreachable API when the session store is down (503)', async () => {
        getMe.mockRejectedValue(httpError(503));

        const probe = renderProvider();

        await waitFor(() => expect(probe.status()).toBe(AuthStatus.Unreachable));
    });

    it('keeps a signed-in visitor signed in when a later refresh cannot reach the API', async () => {
        getMe.mockResolvedValueOnce(buildUser()).mockRejectedValueOnce(new AxiosError('Network Error'));

        const probe = renderProvider();
        await waitFor(() => expect(probe.status()).toBe(AuthStatus.Authenticated));

        await act(async () => {
            probe.refreshButton().click();
        });

        expect(probe.status()).toBe(AuthStatus.Authenticated);
        expect(probe.userId()).toBe('user-1');
    });

    it('retries by itself once the browser is back online', async () => {
        getMe.mockRejectedValueOnce(new AxiosError('Network Error')).mockResolvedValueOnce(buildUser());

        const probe = renderProvider();
        await waitFor(() => expect(probe.status()).toBe(AuthStatus.Unreachable));

        await act(async () => {
            window.dispatchEvent(new Event('online'));
        });

        await waitFor(() => expect(probe.status()).toBe(AuthStatus.Authenticated));
    });
});

/** Renders the provider and returns queries scoped to this render - the suite shares one DOM. */
function renderProvider(): { status: () => string; userId: () => string; refreshButton: () => HTMLElement } {
    const { container } = render(
        <AuthProvider>
            <StatusProbe />
        </AuthProvider>,
    );
    const scope = within(container);

    return {
        status: () => String(scope.getByTestId('status').textContent),
        userId: () => String(scope.getByTestId('user').textContent),
        refreshButton: () => scope.getByTestId('refresh'),
    };
}

function StatusProbe(): JSX.Element {
    const { status, user, refreshUser } = useAuth();

    return (
        <div>
            <span data-testid="status">{status}</span>
            <span data-testid="user">{user?.userId ?? 'none'}</span>
            <button data-testid="refresh" onClick={() => void refreshUser()} />
        </div>
    );
}

function buildUser(): UserResponse {
    return { userId: 'user-1', email: 'lifter@example.com', displayName: 'Lifter', workspaces: [] };
}

function httpError(status: number): AxiosError {
    const error = new AxiosError('Request failed');
    const headers = new AxiosHeaders();

    error.response = { status, statusText: '', data: {}, headers, config: { headers } };

    return error;
}
