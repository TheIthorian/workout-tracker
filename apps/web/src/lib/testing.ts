/**
 * Runs `body` on a page whose `crypto` has no `randomUUID`, as an insecure context has none.
 *
 * Awaits `body`, so the stub outlives code that reaches for `randomUUID` only after an await — a
 * synchronous scope would be long gone by then and the test would pass whatever the code does.
 *
 * The property lives on `Crypto.prototype` rather than on the instance, so overriding it leaves an
 * own property shadowing the original: restoring has to delete that shadow, not write the old
 * descriptor back, or every later test in the file keeps the stubbed value.
 */
export async function withoutRandomUUID(body: () => void | Promise<void>): Promise<void> {
    const ownDescriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });

    try {
        await body();
    } finally {
        if (ownDescriptor) Object.defineProperty(crypto, 'randomUUID', ownDescriptor);
        else Reflect.deleteProperty(crypto, 'randomUUID');
    }
}
