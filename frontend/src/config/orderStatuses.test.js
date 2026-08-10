import { describe, expect, it } from 'vitest';
import { classifyOrder, getOrderStatus } from './orderStatuses.js';

describe('order status classification', () => {
    it.each([
        [ { status: 'created' }, 'payable' ],
        [ { status: { code: 'payment' } }, 'payable' ],
        [ { status: 'paid' }, 'paid' ],
        [ { status: 'washing' }, 'paid' ],
        [ { status_code: 'canceled' }, 'closed' ],
        [ { status: 'unexpected' }, 'unknown' ],
    ])('classifies %#', (order, expected) => {
        expect(classifyOrder(order)).toBe(expected);
    });

    it('normalizes a status slug', () => {
        expect(getOrderStatus({ status: { slug: 'PAID' } })).toBe('paid');
    });
});
