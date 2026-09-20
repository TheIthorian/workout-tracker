import { describe, expect, it } from 'vitest';
import { isClientIdMetadataDocumentUrl, isVerifiedClientId, parseVerifiedClientIds } from './client-id.js';

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

describe('parseVerifiedClientIds', () => {
    it('splits and normalizes whole URLs', () => {
        expect(parseVerifiedClientIds(' https://Claude.AI/oauth/client , https://cursor.com/mcp/client ')).toEqual([
            'https://claude.ai/oauth/client',
            'https://cursor.com/mcp/client',
        ]);
        expect(parseVerifiedClientIds('')).toEqual([]);
    });

    it('keeps a directory prefix but drops entries that are not usable client id URLs', () => {
        expect(parseVerifiedClientIds('https://vendor.example/clients/')).toEqual(['https://vendor.example/clients/']);
        expect(parseVerifiedClientIds('claude.ai,http://claude.ai/oauth/client,https://claude.ai')).toEqual([]);
    });
});

describe('isVerifiedClientId', () => {
    const verifiedClientIds = parseVerifiedClientIds('https://claude.ai/oauth/client,https://vendor.example/clients/');

    it('vouches for an exactly listed URL', () => {
        expect(isVerifiedClientId({ clientId: 'https://claude.ai/oauth/client', verifiedClientIds })).toBe(true);
    });

    // The reason entries are URLs and not hosts: claude.ai also serves documents its users publish.
    it('does not vouch for another path on a listed host', () => {
        expect(
            isVerifiedClientId({
                clientId: 'https://claude.ai/public/artifacts/6ddbef52-2d3a-49df-a2b7-7cd0e8adba52',
                verifiedClientIds,
            }),
        ).toBe(false);
    });

    it('does not vouch for a host that merely ends with a listed one', () => {
        expect(isVerifiedClientId({ clientId: 'https://evil-claude.ai/oauth/client', verifiedClientIds })).toBe(false);
    });

    it('vouches for anything under a listed directory prefix, but not for the prefix itself', () => {
        expect(isVerifiedClientId({ clientId: 'https://vendor.example/clients/abc', verifiedClientIds })).toBe(true);
        expect(isVerifiedClientId({ clientId: 'https://vendor.example/clients/', verifiedClientIds })).toBe(false);
    });

    // `…/clients` must not be read as a prefix of `…/clientsevil`.
    it('does not let a prefix entry match a sibling path that merely starts with it', () => {
        expect(isVerifiedClientId({ clientId: 'https://vendor.example/clientsevil', verifiedClientIds })).toBe(false);
    });

    it('resolves dot segments before comparing', () => {
        expect(isVerifiedClientId({ clientId: 'https://claude.ai/public/../oauth/client', verifiedClientIds })).toBe(
            true,
        );
        expect(isVerifiedClientId({ clientId: 'https://vendor.example/clients/../secret', verifiedClientIds })).toBe(
            false,
        );
    });

    it('vouches for nothing when the list is empty', () => {
        expect(isVerifiedClientId({ clientId: 'https://claude.ai/oauth/client', verifiedClientIds: [] })).toBe(false);
    });
});
