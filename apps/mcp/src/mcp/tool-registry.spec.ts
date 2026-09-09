import { describe, expect, it } from 'vitest';
import { buildToolName, toolBehaviorHints, toSnakeCase } from './tool-registry.js';

describe('toSnakeCase', () => {
    it('lowercases a single word', () => {
        expect(toSnakeCase('Get')).toBe('get');
    });

    it('inserts an underscore before an upper-case letter that follows a lower-case one', () => {
        expect(toSnakeCase('GetCurrentUser')).toBe('get_current_user');
    });

    // An underscore goes in when the PREVIOUS character is lower-case OR the NEXT one is, which is
    // what keeps an acronym together and still splits the word that follows it.
    it('keeps an acronym run together and splits the word after it', () => {
        expect(toSnakeCase('ParseHTMLDocument')).toBe('parse_html_document');
    });

    it('returns whitespace-only and empty input unchanged', () => {
        expect(toSnakeCase('')).toBe('');
        expect(toSnakeCase('   ')).toBe('   ');
    });
});

describe('buildToolName', () => {
    it('snake-cases the declared name', () => {
        expect(buildToolName('ListItems')).toBe('list_items');
        expect(buildToolName('GetCurrentUser')).toBe('get_current_user');
    });
});

describe('toolBehaviorHints', () => {
    it('marks reads read-only and idempotent', () => {
        expect(toolBehaviorHints('GetCurrentUser')).toEqual({
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        });
    });

    // A create is not idempotent (calling it twice makes two rows) but is not destructive either;
    // an update is the reverse. Clients use both hints to decide whether to retry a timed-out call.
    it('separates create from destructive mutation', () => {
        expect(toolBehaviorHints('CreateItem')).toMatchObject({ destructiveHint: false, idempotentHint: false });
        expect(toolBehaviorHints('UpdateItem')).toMatchObject({ destructiveHint: true, idempotentHint: false });
        expect(toolBehaviorHints('DeleteItem')).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    });

    // A tool nobody has added an entry for must default to the safe assumption rather than silently
    // inheriting `false` everywhere.
    it('defaults an unknown tool to destructive and open-world', () => {
        expect(toolBehaviorHints('SomeToolNobodyHasWrittenYet')).toEqual({
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        });
    });
});
