import { isIPv4, isIPv6 } from 'node:net';

/**
 * Whether an IP address is a public unicast address — somewhere on the internet rather than
 * somewhere inside this deployment.
 *
 * Everything else is refused: loopback, private and carrier-grade-NAT ranges, link-local (which is
 * where cloud instance-metadata services live), multicast, and the reserved and documentation
 * blocks. Unknown-shaped input is refused too, because a value that cannot be classified cannot be
 * shown to be safe.
 */
export function isPublicUnicastAddress(address: string): boolean {
    if (isIPv4(address)) return isPublicIPv4(toIPv4Bytes(address));

    if (isIPv6(address)) return isPublicIPv6(address);

    return false;
}

/** IPv4 blocks that are not public unicast, as `[first byte..., prefix length]`. */
const PRIVATE_IPV4_BLOCKS: { bytes: number[]; prefix: number }[] = [
    { bytes: [0, 0, 0, 0], prefix: 8 }, // "this network"
    { bytes: [10, 0, 0, 0], prefix: 8 }, // private
    { bytes: [100, 64, 0, 0], prefix: 10 }, // carrier-grade NAT
    { bytes: [127, 0, 0, 0], prefix: 8 }, // loopback
    { bytes: [169, 254, 0, 0], prefix: 16 }, // link-local, and cloud instance metadata
    { bytes: [172, 16, 0, 0], prefix: 12 }, // private
    { bytes: [192, 0, 0, 0], prefix: 24 }, // IETF protocol assignments
    { bytes: [192, 0, 2, 0], prefix: 24 }, // documentation
    { bytes: [192, 88, 99, 0], prefix: 24 }, // 6to4 relay anycast
    { bytes: [192, 168, 0, 0], prefix: 16 }, // private
    { bytes: [198, 18, 0, 0], prefix: 15 }, // benchmarking
    { bytes: [198, 51, 100, 0], prefix: 24 }, // documentation
    { bytes: [203, 0, 113, 0], prefix: 24 }, // documentation
    { bytes: [224, 0, 0, 0], prefix: 4 }, // multicast
    { bytes: [240, 0, 0, 0], prefix: 4 }, // reserved, including the broadcast address
];

function isPublicIPv4(bytes: number[]): boolean {
    return !PRIVATE_IPV4_BLOCKS.some((block) => matchesPrefix({ bytes, block: block.bytes, prefix: block.prefix }));
}

/**
 * IPv6 is checked through its expanded 16 bytes so that a v4 address tunnelled inside one -
 * v4-mapped, NAT64 or 6to4 - is classified as the v4 address it really reaches.
 */
function isPublicIPv6(address: string): boolean {
    const bytes = toIPv6Bytes(address);

    if (!bytes) return false;

    if (bytes.every((byte) => byte === 0)) return false; // unspecified
    if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return false; // loopback

    if (matchesPrefix({ bytes, block: [0xfc, 0], prefix: 7 })) return false; // unique local
    if (matchesPrefix({ bytes, block: [0xfe, 0x80], prefix: 10 })) return false; // link local
    if (matchesPrefix({ bytes, block: [0xff], prefix: 8 })) return false; // multicast
    if (matchesPrefix({ bytes, block: [0x01, 0x00], prefix: 64 })) return false; // discard-only
    if (matchesPrefix({ bytes, block: [0x20, 0x01, 0x0d, 0xb8], prefix: 32 })) return false; // documentation

    // v4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96) both carry the v4 address in the last four.
    const v4Mapped = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];
    const nat64 = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];

    if (matchesPrefix({ bytes, block: v4Mapped, prefix: 96 }) || matchesPrefix({ bytes, block: nat64, prefix: 96 })) {
        return isPublicIPv4(bytes.slice(12));
    }

    // 6to4 (2002::/16) carries it in the two words after the prefix.
    if (matchesPrefix({ bytes, block: [0x20, 0x02], prefix: 16 })) return isPublicIPv4(bytes.slice(2, 6));

    return true;
}

/** Whether `bytes` falls inside `block/prefix`; `block` may be shorter than `bytes` and zero-fills. */
function matchesPrefix({ bytes, block, prefix }: { bytes: number[]; block: number[]; prefix: number }): boolean {
    for (let index = 0; index * 8 < prefix; index += 1) {
        const remaining = prefix - index * 8;
        const mask = remaining >= 8 ? 0xff : (0xff << (8 - remaining)) & 0xff;

        if ((bytes[index] & mask) !== ((block[index] ?? 0) & mask)) return false;
    }

    return true;
}

function toIPv4Bytes(address: string): number[] {
    return address.split('.').map((part) => Number(part));
}

/** Expands any `net.isIPv6` form - `::`, a dotted-quad tail, or full - to its 16 bytes. */
function toIPv6Bytes(address: string): number[] | null {
    const [head, tail] = address.split('%'); // drop any zone identifier
    const normalized = expandEmbeddedIPv4(head);
    const [left, right, ...rest] = normalized.split('::');

    if (rest.length > 0 || tail === '') return null;

    const leftGroups = left.length > 0 ? left.split(':') : [];
    const rightGroups = right !== undefined && right.length > 0 ? right.split(':') : [];
    const missing = 8 - leftGroups.length - rightGroups.length;

    if (right === undefined && missing !== 0) return null;
    if (missing < 0) return null;

    const groups = [...leftGroups, ...Array<string>(right === undefined ? 0 : missing).fill('0'), ...rightGroups];

    return groups.flatMap((group) => {
        const value = Number.parseInt(group, 16);

        return [(value >> 8) & 0xff, value & 0xff];
    });
}

/** Rewrites a dotted-quad tail (`::ffff:127.0.0.1`) into the two hex groups it stands for. */
function expandEmbeddedIPv4(address: string): string {
    const lastColon = address.lastIndexOf(':');
    const tail = address.slice(lastColon + 1);

    if (!isIPv4(tail)) return address;

    const [a, b, c, d] = toIPv4Bytes(tail);
    const groups = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;

    return `${address.slice(0, lastColon + 1)}${groups}`;
}
