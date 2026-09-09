import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '@app/errors';
import { LlmClient } from './client.js';

function stubFetch(): typeof fetch {
    return vi.fn(
        async () =>
            new Response(JSON.stringify({ id: '1', object: 'chat.completion', created: 0, model: 'x', choices: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
    ) as unknown as typeof fetch;
}

describe('LlmClient', () => {
    it('constructs successfully with a valid absolute baseUrl', () => {
        const client = new LlmClient({
            config: { apiKey: 'key', baseUrl: 'https://openrouter.ai/api/v1', model: 'gpt-test' },
            fetch: stubFetch(),
        });

        expect(client.model).toBe('gpt-test');
    });

    it('throws a typed ConfigurationError for a relative baseUrl', () => {
        expect(() => new LlmClient({ config: { apiKey: 'key', baseUrl: '/api/v1', model: 'gpt-test' } })).toThrow(
            ConfigurationError,
        );
        expect(() => new LlmClient({ config: { apiKey: 'key', baseUrl: '/api/v1', model: 'gpt-test' } })).toThrow(
            /baseUrl must be an absolute URL/,
        );
    });

    it('throws a typed ConfigurationError for a non-http(s) baseUrl', () => {
        expect(
            () => new LlmClient({ config: { apiKey: 'key', baseUrl: 'ftp://example.com', model: 'gpt-test' } }),
        ).toThrow(ConfigurationError);
        expect(
            () => new LlmClient({ config: { apiKey: 'key', baseUrl: 'ftp://example.com', model: 'gpt-test' } }),
        ).toThrow(/baseUrl must be an absolute URL/);
    });

    it('throws a typed ConfigurationError for a garbage baseUrl string', () => {
        expect(() => new LlmClient({ config: { apiKey: 'key', baseUrl: 'not a url', model: 'gpt-test' } })).toThrow(
            ConfigurationError,
        );
        expect(() => new LlmClient({ config: { apiKey: 'key', baseUrl: 'not a url', model: 'gpt-test' } })).toThrow(
            /baseUrl must be an absolute URL/,
        );
    });

    it('carries a 500 problem body naming ConfigurationError', () => {
        try {
            new LlmClient({ config: { apiKey: 'key', baseUrl: 'not a url', model: 'gpt-test' } });
            expect.unreachable('constructor should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(ConfigurationError);
            const configError = error as ConfigurationError;
            expect(configError.statusCode).toBe(500);
            expect(configError.problem.type).toMatch(/ConfigurationError/);
        }
    });

    it('sends requests to the configured baseUrl, not a default', async () => {
        const fetchStub = stubFetch();
        const client = new LlmClient({
            config: { apiKey: 'key', baseUrl: 'https://openrouter.ai/api/v1', model: 'gpt-test' },
            fetch: fetchStub,
        });

        await client.openai.chat.completions.create({ model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] });

        const calledUrl = String((fetchStub as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
        expect(calledUrl.startsWith('https://openrouter.ai/api/v1')).toBe(true);
    });
});
