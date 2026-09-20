import { describe, expect, it } from 'vitest';
import { isAllowlistedClientDomain, isClientIdMetadataDocumentUrl, parseAllowedClientDomains } from './client-id.js';

describe('isClientIdMetadataDocumentUrl', () => {
    it('accepts an https URL with a path', () => {
        expect(isClientIdMetadataDocumentUrl('https://client.example/oauth-client')).toBe(true);
    });

    it('refuses http, so the document cannot be swapped in transit', () => {
        expect(isClientIdMetadataDocumentUrl('http://client.example/oauth-client')).toBe(false);
    });

    it('refuses a bare origin', () => {
        expect(isClientIdMetadataDocumentUrl('https://client.example')).toBe(false);
        expect(isClientIdMetadataDocumentUrl('https://client.example/')).toBe(false);
    });

    it('refuses a fragment or embedded credentials', () => {
        expect(isClientIdMetadataDocumentUrl('https://client.example/oauth-client#frag')).toBe(false);
        expect(isClientIdMetadataDocumentUrl('https://user:pass@client.example/oauth-client')).toBe(false);
    });

    it('refuses anything that is not a URL', () => {
        expect(isClientIdMetadataDocumentUrl('not-a-url')).toBe(false);
        expect(isClientIdMetadataDocumentUrl('')).toBe(false);
    });
});

describe('parseAllowedClientDomains', () => {
    it('splits, trims and lowercases, and drops empties', () => {
        expect(parseAllowedClientDomains(' Claude.ai , , cursor.com ')).toEqual(['claude.ai', 'cursor.com']);
        expect(parseAllowedClientDomains('')).toEqual([]);
    });
});

describe('isAllowlistedClientDomain', () => {
    const allowedDomains = ['claude.ai'];

    it('accepts an exact host match, whatever the path', () => {
        expect(isAllowlistedClientDomain({ clientId: 'https://claude.ai/oauth-client', allowedDomains })).toBe(true);
    });

    // The whole reason the comparison is exact: a suffix match would hand `evil-claude.ai` the
    // trust an operator meant for `claude.ai`.
    it('refuses a host that merely ends with an allowlisted one', () => {
        expect(isAllowlistedClientDomain({ clientId: 'https://evil-claude.ai/oauth-client', allowedDomains })).toBe(
            false,
        );
    });

    it('refuses a subdomain that was not listed in its own right', () => {
        expect(isAllowlistedClientDomain({ clientId: 'https://apps.claude.ai/oauth-client', allowedDomains })).toBe(
            false,
        );
    });

    it('refuses everything when the allowlist is empty', () => {
        expect(isAllowlistedClientDomain({ clientId: 'https://claude.ai/oauth-client', allowedDomains: [] })).toBe(
            false,
        );
    });
});
