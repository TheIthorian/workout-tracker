import { lookup as resolveHostname } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import { isPublicUnicastAddress } from './ip-address.js';

/** The subset of `fetch` this package uses, so a test supplies its own without a global stub. */
export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** Raised instead of performing a request that would leave the public internet. */
export class BlockedAddressError extends Error {}

/** What Node hands a custom `lookup`, and what it expects back. */
type LookupOptions = { family?: number | string; all?: boolean };
type LookupAddress = { address: string; family: number };
type LookupCallback = (error: Error | null, addressOrAddresses: string | LookupAddress[], family?: number) => void;

/**
 * A `fetch` that will only talk to public internet addresses.
 *
 * A URL a caller supplied is a URL this deployment's network will dereference from the inside, so
 * without this any endpoint that follows one is a server-side request forgery primitive pointed at
 * whatever that network can reach — a cloud instance-metadata service most of all.
 *
 * Resolution happens once, here, and the resolved addresses are then pinned onto the connection.
 * Validating a hostname and then handing the hostname to `fetch` would leave a DNS-rebinding window
 * in which the second lookup returns an address the first one did not.
 *
 * There is no option to relax any of this. Code that genuinely needs to reach a private address
 * should call `fetch` itself rather than ask a security boundary to stand aside.
 */
export function createSafeFetch(): FetchLike {
    return async (url: string | URL, init?: RequestInit): Promise<Response> => {
        const target = new URL(url);

        if (target.protocol !== 'https:') throw new BlockedAddressError('Only https URLs may be fetched.');

        const addresses = await resolveAddresses({ hostname: target.hostname });
        const dispatcher = new Agent({ connect: { lookup: pinLookup(addresses) } });

        try {
            return await globalThis.fetch(target, { ...init, dispatcher } as RequestInit);
        } finally {
            await dispatcher.close();
        }
    };
}

/**
 * Every address the hostname resolves to, having checked that all of them are public.
 *
 * All of them, not the first: a record that mixes one public address with one private one is
 * exactly how this gets attacked, and which one a connection picks is not ours to decide.
 */
async function resolveAddresses({ hostname }: { hostname: string }): Promise<LookupAddress[]> {
    // A bracketed IPv6 literal arrives with its brackets still on.
    const literal = hostname.replace(/^\[|\]$/g, '');

    const resolved: LookupAddress[] =
        isIP(literal) !== 0
            ? [{ address: literal, family: isIP(literal) }]
            : await resolveHostname(hostname, { all: true, verbatim: true });

    if (resolved.length === 0) throw new BlockedAddressError(`${hostname} resolves to nothing.`);

    if (!resolved.every((entry) => isPublicUnicastAddress(entry.address))) {
        throw new BlockedAddressError(`${hostname} resolves to a non-public address.`);
    }

    return resolved;
}

/** Hands the connection the addresses already checked, so no second resolution can differ. */
function pinLookup(addresses: LookupAddress[]) {
    return (_hostname: string, options: LookupOptions, callback: LookupCallback): void => {
        // `family` arrives as 4/6, as "IPv4"/"IPv6", or absent, depending on the caller.
        const family = typeof options.family === 'string' ? Number(options.family.replace('IPv', '')) : options.family;
        const matching = family ? addresses.filter((entry) => entry.family === family) : addresses;
        const usable = matching.length > 0 ? matching : addresses;

        if (options.all) {
            callback(null, usable);

            return;
        }

        callback(null, usable[0].address, usable[0].family);
    };
}
