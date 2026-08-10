import { describe, expect, it } from 'vitest';
import {
    getConfiguredPaymentMethods,
    getPaymentMethodCode,
} from './paymentMethods.js';

describe('payment methods', () => {
    it('normalizes API aliases', () => {
        expect(getPaymentMethodCode('vendotek')).toBe('card');
        expect(getPaymentMethodCode('bank_card')).toBe('card');
        expect(getPaymentMethodCode({ type: 'cash' })).toBe('cash');
    });

    it('requires both configuration and device readiness', () => {
        const methods = getConfiguredPaymentMethods({
            payment_methods: [ 'card', 'cash' ],
        }, {
            card: {
                available: true,
            },
            cash: {
                available: false,
                unavailableLabel: 'Купюроприёмник недоступен',
            },
        });

        expect(methods.find(item => item.code === 'card').available)
            .toBe(true);
        expect(methods.find(item => item.code === 'cash'))
            .toMatchObject({
                available: false,
                unavailableLabel: 'Купюроприёмник недоступен',
            });
    });

    it('honors a disabled method from the property API', () => {
        const methods = getConfiguredPaymentMethods({
            payment_methods: [
                { type: 'cash', enabled: false },
                { type: 'card', available: false },
            ],
        }, {
            cash: { available: true },
            card: { available: true },
        });

        expect(methods).toHaveLength(1);
        expect(methods[0]).toMatchObject({
            code: 'card',
            available: false,
        });
    });
});
