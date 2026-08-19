import { describe, expect, it } from 'vitest';
import {
    calculateCashbackAmount,
    getCashbackLoyalty,
} from './cashback.js';

describe('getCashbackLoyalty', () => {
    it('returns an active cashback configuration from the property response', () => {
        expect(getCashbackLoyalty([
            { id: 1, type: 'happy_hours', percent: 10 },
            { id: 2, type: 'cashback', percent: '7' },
        ])).toEqual({ id: 2, type: 'cashback', percent: '7' });
    });

    it('ignores missing and zero-percent cashback configurations', () => {
        expect(getCashbackLoyalty(null)).toBeNull();
        expect(getCashbackLoyalty([
            { id: 2, type: 'cashback', percent: 0 },
        ])).toBeNull();
    });
});

describe('calculateCashbackAmount', () => {
    it('calculates the bonus amount in rubles', () => {
        expect(calculateCashbackAmount(250, 7)).toBe(17.5);
        expect(calculateCashbackAmount(199.99, 7)).toBe(14);
    });

    it('returns zero for invalid values', () => {
        expect(calculateCashbackAmount(undefined, 7)).toBe(0);
        expect(calculateCashbackAmount(250, 0)).toBe(0);
    });
});
