import { describe, expect, it } from 'vitest';
import { createOrderUrl } from './orderUrl.js';

describe('order URL', () => {
    it('builds a mobile app URL for the current order', () => {
        expect(createOrderUrl({
            orderId: 1524,
            appUrl: 'https://app.example.com/',
        })).toBe('https://app.example.com/order/1524');
    });

    it('uses the production app URL when it is not configured', () => {
        expect(createOrderUrl({ orderId: 42 })).toBe(
            'https://app.my-post.online/order/42'
        );
    });

    it('does not build a URL without an order id', () => {
        expect(createOrderUrl({ appUrl: 'https://app.example.com' })).toBe('');
    });
});
