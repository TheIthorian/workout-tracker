import { describe, expect, it } from 'vitest';
import { ResourceUrlGenerator } from './resource-url-generator.js';

const urls = new ResourceUrlGenerator({
    config: {
        webAppBaseUrl: 'https://app.example.com',
        apiBaseUrl: 'https://api.example.com',
        mcpBaseUrl: 'https://mcp.example.com',
    },
});

describe('ResourceUrlGenerator', () => {
    it('builds a web app url against the web origin', () => {
        expect(urls.webAppUrl({ path: '/exercises/e1' })).toBe('https://app.example.com/exercises/e1');
    });

    // The prefix belongs to the API as a whole, not to any one resource, so the generator adds it
    // and callers pass the route path alone.
    it('builds an API url against the api origin, under the /api/v1 prefix', () => {
        expect(urls.apiUrl({ path: '/exercises/e1' })).toBe('https://api.example.com/api/v1/exercises/e1');
    });

    // The MCP server is its own deployment, so its urls carry neither the web origin nor the API's
    // `/api/v1` prefix.
    it('builds an MCP url against the mcp origin, with no api prefix', () => {
        expect(urls.mcpUrl({ path: '/mcp/token-value' })).toBe('https://mcp.example.com/mcp/token-value');
    });

    // `WebAppLinkGenerator.BaseUrl` documents itself as "without a trailing slash"; a configured
    // value that has one must not produce a doubled slash.
    it('tolerates trailing slashes on either origin and a path with no leading slash', () => {
        const tolerant = new ResourceUrlGenerator({
            config: {
                webAppBaseUrl: 'https://app.example.com/',
                apiBaseUrl: 'https://api.example.com//',
                mcpBaseUrl: 'https://mcp.example.com/',
            },
        });

        expect(tolerant.webAppUrl({ path: 'exercises/e1' })).toBe('https://app.example.com/exercises/e1');
        expect(tolerant.apiUrl({ path: 'exercises/e1' })).toBe('https://api.example.com/api/v1/exercises/e1');
        expect(tolerant.mcpUrl({ path: 'mcp/token-value' })).toBe('https://mcp.example.com/mcp/token-value');
    });

    it('attaches both links to a payload, leaving its other fields alone', () => {
        const attached = urls.attach({
            resource: { id: 'r1', title: 'Soup' },
            webPath: '/exercises/e1',
            apiPath: '/exercises/e1',
        });

        expect(attached).toEqual({
            id: 'r1',
            title: 'Soup',
            webUrl: 'https://app.example.com/exercises/e1',
            resourceUrl: 'https://api.example.com/api/v1/exercises/e1',
        });
    });
});
