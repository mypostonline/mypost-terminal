import { describe, expect, it } from 'vitest';
import { formatCountdown, getSecondsUntil } from './paymentTimer.js';

describe('payment countdown', () => {
    it('calculates whole seconds until a deadline', () => {
        expect(getSecondsUntil(
            '2026-08-13T10:10:00.000Z',
            Date.parse('2026-08-13T10:00:00.000Z')
        )).toBe(600);
    });

    it('does not return a negative countdown', () => {
        expect(getSecondsUntil(
            '2026-08-13T10:00:00.000Z',
            Date.parse('2026-08-13T10:01:00.000Z')
        )).toBe(0);
    });

    it('formats a countdown as minutes and seconds', () => {
        expect(formatCountdown(600)).toBe('10:00');
        expect(formatCountdown(65)).toBe('01:05');
        expect(formatCountdown(0)).toBe('00:00');
    });
});
