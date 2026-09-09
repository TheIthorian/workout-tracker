import { Decimal as BaseDecimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal.js';

describe('Decimal', () => {
    it('rounds ties away from zero, in both directions', () => {
        expect(new Decimal('0.5').toDecimalPlaces(0).toString()).toBe('1');
        expect(new Decimal('-0.5').toDecimalPlaces(0).toString()).toBe('-1');
        expect(new Decimal('1.5').toDecimalPlaces(0).toString()).toBe('2');
        expect(new Decimal('2.5').toDecimalPlaces(0).toString()).toBe('3');
    });

    it('is exact where binary floating point is not', () => {
        expect(new Decimal('0.1').plus('0.2').toString()).toBe('0.3');
        expect(0.1 + 0.2).not.toBe(0.3);
    });

    // The whole reason this module clones the constructor instead of calling `Decimal.set(...)`:
    // global config would depend on module import order and leak into every other consumer.
    it('is a clone, so reconfiguring it cannot leak into the global constructor', () => {
        expect(Decimal).not.toBe(BaseDecimal);

        const globalRounding = BaseDecimal.rounding;
        Decimal.set({ rounding: BaseDecimal.ROUND_DOWN });

        try {
            expect(BaseDecimal.rounding).toBe(globalRounding);
        } finally {
            Decimal.set({ rounding: BaseDecimal.ROUND_HALF_UP });
        }
    });
});
