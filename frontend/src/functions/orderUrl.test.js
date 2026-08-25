import { describe, expect, it } from 'vitest';
import { createOrderUrl } from './orderUrl.js';

describe('order URL', () => {
    it('builds a unique mobile app URL from the order UUID', () => {
        expect(createOrderUrl({
            orderUuid: '1c58304f-d1b2-45ff-8189-cd51a8207076',
            appUrl: 'https://app.example.com/',
        })).toBe(
            'https://app.example.com/order/' +
            '1c58304f-d1b2-45ff-8189-cd51a8207076'
        );
    });

    it('uses the production app URL when it is not configured', () => {
        expect(createOrderUrl({
            orderUuid: '1c58304f-d1b2-45ff-8189-cd51a8207076',
        })).toBe(
            'https://app.my-post.online/order/' +
            '1c58304f-d1b2-45ff-8189-cd51a8207076'
        );
    });

    it('does not build a URL without an order UUID', () => {
        expect(createOrderUrl({ appUrl: 'https://app.example.com' })).toBe('');
    });
});
