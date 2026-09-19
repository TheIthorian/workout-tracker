// @vitest-environment jsdom
import { render, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';
import { AuthStatus } from '@/contexts/AuthContext';
import type { UserResponse } from '@/models/user';

const auth = vi.hoisted(() => ({ value: {} as { user: UserResponse | null; status: AuthStatus } }));

vi.mock('@/contexts/AuthContext', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/contexts/AuthContext')>()),
    useAuth: () => ({ ...auth.value, refreshUser: vi.fn() }),
}));

describe('ProtectedRoute', () => {
    it('renders the route for a signed-in visitor', () => {
        const scope = renderRoute({ user: buildUser(), status: AuthStatus.Authenticated });

        expect(scope.queryByText('workout')).toBeTruthy();
    });

    it('redirects to sign-in when the API said there is no session', () => {
        const scope = renderRoute({ user: null, status: AuthStatus.SignedOut });

        expect(scope.queryByText('login page')).toBeTruthy();
    });

    // Losing signal mid-workout is not a sign-out: bouncing to the login page would throw away the
    // route someone was on to log their next set, for a session that is still perfectly valid.
    it('offers a retry instead of the login page when the API is unreachable', () => {
        const scope = renderRoute({ user: null, status: AuthStatus.Unreachable });

        expect(scope.queryByText('login page')).toBeNull();
        expect(scope.getByRole('button', { name: /try again/i })).toBeTruthy();
    });
});

function renderRoute({ user, status }: { user: UserResponse | null; status: AuthStatus }): ReturnType<typeof within> {
    auth.value = { user, status };

    const { container } = render(
        <MemoryRouter initialEntries={['/today']}>
            <Routes>
                <Route
                    path="/today"
                    element={
                        <ProtectedRoute>
                            <span>workout</span>
                        </ProtectedRoute>
                    }
                />
                <Route path="/login" element={<span>login page</span>} />
            </Routes>
        </MemoryRouter>,
    );

    return within(container);
}

function buildUser(): UserResponse {
    return { userId: 'user-1', email: 'lifter@example.com', displayName: 'Lifter', workspaces: [] };
}
