import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { authApi } from '@/lib/api';
import type { UserResponse } from '@/models/user';
import { isAxiosError } from 'axios';

/** What the last attempt to resolve the current user established. */
export enum AuthStatus {
    /** No attempt has resolved yet. */
    Loading = 'loading',
    /** The API returned a user. */
    Authenticated = 'authenticated',
    /** The API answered 401: there is no session. */
    SignedOut = 'signed-out',
    /** The API could not be reached, so whether there is a session is still unknown. */
    Unreachable = 'unreachable',
}

interface AuthContextType {
    user?: UserResponse | null;
    status: AuthStatus;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string, displayName?: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    clearCurrentUser: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<UserResponse | null>(null);
    const [status, setStatus] = useState<AuthStatus>(AuthStatus.Loading);

    const refreshUser = useCallback(async () => {
        try {
            const userData = await authApi.getMe();
            setUser(userData);
            setStatus(AuthStatus.Authenticated);
        } catch (error) {
            // Only a 401 answers the question. A dropped connection, a timeout on gym wifi, or a
            // 503 from an API that could not reach its session store all leave it open, and
            // clearing the user there ends a workout at the sign-in screen with a session that was
            // valid the whole time - `ProtectedRoute` redirects on a missing user, not on a 401.
            if (isAxiosError(error) && error.response?.status === 401) {
                setUser(null);
                setStatus(AuthStatus.SignedOut);
                return;
            }

            setStatus((current) => (current === AuthStatus.Authenticated ? current : AuthStatus.Unreachable));
        }
    }, []);

    useEffect(() => {
        void refreshUser();
    }, [refreshUser]);

    // Coming back into signal is the common way out of `Unreachable` on a phone at the gym, so
    // take it rather than making someone find the retry button.
    useEffect(() => {
        if (status !== AuthStatus.Unreachable) return;

        const retry = (): void => {
            void refreshUser();
        };

        window.addEventListener('online', retry);

        return () => window.removeEventListener('online', retry);
    }, [status, refreshUser]);

    const login = async (email: string, password: string) => {
        await authApi.login({ email, password });
        await refreshUser();
    };

    const register = async (email: string, password: string, displayName?: string) => {
        await authApi.register({ email, password, displayName });
    };

    const logout = async () => {
        await authApi.logout();
        setUser(null);
        setStatus(AuthStatus.SignedOut);
    };

    const clearCurrentUser = () => {
        setUser(null);
        setStatus(AuthStatus.SignedOut);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                status,
                isLoading: status === AuthStatus.Loading,
                login,
                register,
                logout,
                refreshUser,
                clearCurrentUser,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
