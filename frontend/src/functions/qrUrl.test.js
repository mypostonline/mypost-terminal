import { describe, expect, it } from 'vitest';
import { createQrImageUrl } from './qrUrl.js';

describe('createQrImageUrl', () => {
    it('builds a backend SVG URL and encodes the QR payload', () => {
        expect(createQrImageUrl({
            text: 'https://app.example.com/order/15?source=terminal',
            apiUrl: 'https://api.example.com/',
        })).toBe(
            'https://api.example.com/qr/svg?' +
                'text=https%3A%2F%2Fapp.example.com%2Forder%2F15%3Fsource%3Dterminal'
        );
    });

    it('returns an empty URL for an empty payload', () => {
        expect(createQrImageUrl({
            text: '',
            apiUrl: 'https://api.example.com',
        })).toBe('');
    });
});
