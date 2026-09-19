/**
 * A random v4 UUID, on any page this app is served from.
 *
 * `crypto.randomUUID` is restricted to secure contexts, so it is simply absent over plain HTTP — a
 * LAN preview, or a phone pointed at a dev server. `crypto.getRandomValues` carries no such
 * restriction and is what backs the fallback; `Math.random` is not a random source and never
 * appears here.
 */
export function randomUuid(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

    const bytes = crypto.getRandomValues(new Uint8Array(16));

    // RFC 9562 §5.4: version 4 in the top nibble of octet 6, variant 0b10 in the top bits of octet 8.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
