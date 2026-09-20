import { describe, expect, it } from 'vitest';
import { isPublicUnicastAddress } from './ip-address.js';

describe('isPublicUnicastAddress', () => {
    it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '100.63.255.255', '2606:4700:4700::1111'])(
        'accepts the public address %s',
        (address) => {
            expect(isPublicUnicastAddress(address)).toBe(true);
        },
    );

    it.each([
        '0.0.0.0',
        '10.0.0.1',
        '100.64.0.1',
        '127.0.0.1',
        '169.254.169.254',
        '172.16.0.1',
        '172.31.255.255',
        '192.168.1.1',
        '198.18.0.1',
        '203.0.113.5',
        '224.0.0.1',
        '255.255.255.255',
    ])('refuses the non-public IPv4 address %s', (address) => {
        expect(isPublicUnicastAddress(address)).toBe(false);
    });

    it.each(['::', '::1', 'fd00::1', 'fe80::1', 'ff02::1', '2001:db8::1'])(
        'refuses the non-public IPv6 address %s',
        (address) => {
            expect(isPublicUnicastAddress(address)).toBe(false);
        },
    );

    // The interesting cases: a private v4 address wearing a v6 costume still reaches the same host.
    it.each(['::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '64:ff9b::127.0.0.1', '2002:7f00:0001::'])(
        'refuses %s, which tunnels a private IPv4 address',
        (address) => {
            expect(isPublicUnicastAddress(address)).toBe(false);
        },
    );

    it('still accepts a public IPv4 address tunnelled the same way', () => {
        expect(isPublicUnicastAddress('::ffff:1.1.1.1')).toBe(true);
        expect(isPublicUnicastAddress('2002:0101:0101::')).toBe(true);
    });

    it('refuses anything that is not an IP address at all', () => {
        expect(isPublicUnicastAddress('example.com')).toBe(false);
        expect(isPublicUnicastAddress('')).toBe(false);
        expect(isPublicUnicastAddress('999.1.1.1')).toBe(false);
    });
});
