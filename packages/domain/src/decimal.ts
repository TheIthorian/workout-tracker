import { Decimal as BaseDecimal } from 'decimal.js';

/**
 * A decimal.js constructor configured for this package's rounding needs.
 *
 * We deliberately do NOT call the global `Decimal.set(...)` — that mutates process-wide
 * state, so behaviour would depend on module import order, and any other package pulling
 * in decimal.js would silently inherit or override our configuration. Instead we clone the
 * base constructor into one scoped to this package and export only that.
 *
 * `ROUND_HALF_UP` is decimal.js's name for "round half away from zero" (ties round away from zero,
 * e.g. -0.5 -> -1, 0.5 -> 1) — not "round half up" in the sense most readers expect.
 */
export const Decimal = BaseDecimal.clone({ rounding: BaseDecimal.ROUND_HALF_UP });

export type Decimal = InstanceType<typeof Decimal>;
