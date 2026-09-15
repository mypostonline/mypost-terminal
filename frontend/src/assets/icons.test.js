import markup from '../../index.html?raw';
import { describe, expect, it } from 'vitest';

const sprite = new DOMParser().parseFromString(markup, 'text/html');
const outlineIcons = [
    'bank-card', 'qr-payment', 'call', 'phone', 'history', 'loyalty',
    'schedule', 'cash', 'offline', 'smiley-face', 'frowny-face',
    'clock', 'clock-waiting', 'clock-ok', 'clock-error', 'arrow',
    'wallet', 'session', 'home', 'cancel', 'receipt',
];

describe('shared icon sprite', () => {
    it('has no duplicate symbol IDs', () => {
        const ids = [...sprite.querySelectorAll('symbol')].map(symbol => symbol.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it.each(outlineIcons)('uses the common outline style for %s', id => {
        const symbol = sprite.getElementById(id);
        expect(symbol.getAttribute('viewBox')).toBe('0 0 24 24');
        const drawing = symbol.querySelector('g');
        expect(drawing.getAttribute('fill')).toBe('none');
        expect(drawing.getAttribute('stroke')).toBe('currentColor');
        expect(drawing.getAttribute('stroke-width')).toBe('1.75');
        expect(drawing.getAttribute('stroke-linecap')).toBe('round');
        expect(drawing.getAttribute('stroke-linejoin')).toBe('round');
    });

    it('preserves the multicolor SBP brand mark', () => {
        const symbol = sprite.getElementById('sbp');
        expect(symbol.getAttribute('viewBox')).toBe('0 0 42 49');
        expect(symbol.querySelector('g').getAttribute('stroke')).toBe('none');
        expect(new Set([...symbol.querySelectorAll('path')].map(path => path.getAttribute('fill'))).size).toBe(8);
    });
});
