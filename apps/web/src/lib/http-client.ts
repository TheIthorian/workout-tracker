import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { toast } from '@/hooks/use-toast';
import type { ProblemDetails } from '@/models/error';
import { getApiBaseUrl } from './api-base-url';
import { buildAuthPath } from './return-url';

const API_BASE = getApiBaseUrl();

/** Routes a signed-out visitor may legitimately be on, so a 401 there must not bounce them again. */
const PUBLIC_PATHS = ['/login', '/register'];

/** A transport- or platform-level failure, which carries a bare `error` string rather than a problem body. */
type PlatformError = {
    error: string;
};

/**
 * The cookie-session HTTP client for this SPA.
 *
 * Distinct from `@app/api-client`, which is the bearer-token client `apps/mcp` uses: this one
 * sends the session cookie with every request and redirects to sign-in on a 401, neither of which
 * makes sense for a server-to-server caller.
 */
class AppHttpClient {
    private axiosInstance: AxiosInstance;

    constructor() {
        this.axiosInstance = axios.create({
            // In dev, default to same-origin + Vite proxy (see vite.config.ts). Override with VITE_API_BASE_URL.
            baseURL: API_BASE,
            withCredentials: true,
            headers: { 'Content-Type': 'application/json' },
        });

        this.setupInterceptors();
    }

    async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.axiosInstance.get<T>(url, config);
        return response.data;
    }

    async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.axiosInstance.post<T>(url, data, config);
        return response.data;
    }

    async postFormData<T>(url: string, data: FormData): Promise<T> {
        const response = await this.axiosInstance.post<T>(url, data);
        return response.data;
    }

    async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.axiosInstance.put<T>(url, data, config);
        return response.data;
    }

    async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.axiosInstance.patch<T>(url, data, config);
        return response.data;
    }

    async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.axiosInstance.delete<T>(url, config);
        return response.data;
    }

    private setupInterceptors(): void {
        this.axiosInstance.interceptors.request.use(config => {
            // The browser must set the multipart boundary itself, so the JSON default has to go.
            if (config.data instanceof FormData && config.headers) {
                const headers = config.headers;
                if (typeof headers.delete === 'function') {
                    headers.delete('Content-Type');
                } else {
                    delete (headers as Record<string, unknown>)['Content-Type'];
                }
            }
            return config;
        });

        this.axiosInstance.interceptors.response.use(
            response => response,
            (error: AxiosError<ProblemDetails> | AxiosError<PlatformError>) => {
                if (error.response?.status === 401) {
                    this.handleUnauthorizedError(error);
                    return;
                }

                handleAxiosError(error);
                return Promise.reject(error);
            },
        );
    }

    private handleUnauthorizedError(error: AxiosError<ProblemDetails> | AxiosError<PlatformError>): void {
        const pathname = window.location.pathname;

        if (!PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
            // Keep the page the visitor asked for so they land back on it after signing in.
            window.location.href = buildAuthPath('/login', `${pathname}${window.location.search}`);
            return;
        }

        // Already on a sign-in page, so this 401 is a rejected credential rather than an expired
        // session. A lockout comes back as 429 instead and falls through to handleAxiosError.
        if (isAppException(error) && error.response.data.title === 'Unauthorized') {
            toast({
                title: 'Unable to sign in',
                description: 'The email or password you entered is incorrect. Please try again.',
                variant: 'destructive',
            });
        }
    }
}

/** Turns any axios failure into a toast, picking the most specific shape the response matches. */
export function handleAxiosError(error: AxiosError<unknown>): void {
    if (isProblemError(error)) {
        const problemDetail = error.response.data;

        if (problemDetail.errors) {
            const errorMessages = Object.values(problemDetail.errors)
                .map(messages => messages.join(', '))
                .join('\n');

            toast({
                title: problemDetail.title || 'Validation Error',
                description: errorMessages,
                variant: 'destructive',
            });
        } else {
            toast({
                title: problemDetail.title || 'Error',
                description: problemDetail.detail || 'An unexpected error occurred. Please try again later.',
                variant: 'destructive',
            });
        }
    } else if (error.response?.status && [502, 503, 504].includes(error.response.status)) {
        toast({
            title: 'Network Error',
            description: 'Unable to connect to the server. Please try again later.',
            variant: 'destructive',
        });
    } else if (isAppException(error)) {
        const errorData = error.response.data;
        toast({
            title: errorData.title ?? 'Error',
            description: errorData.detail ?? undefined,
            variant: 'destructive',
        });
    } else if (isPlatformError(error)) {
        toast({
            title: error.response?.data?.error || error.message || 'Error',
            variant: 'destructive',
        });
    } else {
        // Anything with no response at all — CORS, DNS, a dropped connection.
        const causeMsg =
            error.cause && typeof error.cause === 'object' && 'message' in error.cause
                ? String((error.cause as { message?: unknown }).message)
                : undefined;
        toast({
            title: error.message || 'Error',
            description: causeMsg || error.message || 'An unexpected error occurred. Please try again later.',
            variant: 'destructive',
        });
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProblemError(error: AxiosError<unknown>): error is AxiosError<ProblemDetails> {
    const data = error.response?.data;
    return isPlainObject(data) && 'errors' in data;
}

function isAppException(error: unknown): error is AxiosError<ProblemDetails> & {
    response: { data: ProblemDetails };
} {
    if (!(error instanceof AxiosError) || !('response' in error)) return false;
    const data = error.response?.data;
    return isPlainObject(data) && 'title' in data && 'type' in data;
}

function isPlatformError(error: unknown): error is AxiosError<PlatformError> {
    if (!(error instanceof AxiosError) || error.response?.data === undefined) return false;
    const data = error.response.data;
    return isPlainObject(data) && 'error' in data;
}

export const httpClient = new AppHttpClient();
