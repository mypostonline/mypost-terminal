import { describe, expect, it } from 'vitest';
import {
    formatRemainingMinutes,
    getRemainingMs,
    tickRemainingMs,
} from './postTimer.js';

describe('post timer', () => {
    it('converts time_left minutes to milliseconds', () => {
        expect(getRemainingMs(3)).toBe(180_000);
        expect(getRemainingMs('1.5')).toBe(90_000);
    });

    it('treats invalid or expired time as zero', () => {
        expect(getRemainingMs(null)).toBe(0);
        expect(getRemainingMs(-1)).toBe(0);
        expect(getRemainingMs('unknown')).toBe(0);
    });

    it('decreases the remaining time without going below zero', () => {
        expect(tickRemainingMs(2_000)).toBe(1_000);
        expect(tickRemainingMs(500)).toBe(0);
    });

    it('rounds the displayed time up to whole minutes', () => {
        expect(formatRemainingMinutes(61_000)).toBe('2 мин');
        expect(formatRemainingMinutes(60_000)).toBe('1 мин');
        expect(formatRemainingMinutes(1)).toBe('1 мин');
        expect(formatRemainingMinutes(0)).toBeNull();
    });
});
