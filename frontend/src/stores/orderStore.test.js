import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import api from '@/functions/api.js';
import { useOrderStore } from './orderStore.js';

vi.mock('@/functions/api.js', () => ({
    default: vi.fn(),
    ApiError: class ApiError extends Error {},
}));

describe('order store paid request', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        api.mockReset().mockResolvedValue({ ok: true });
    });

    it('sends the Vendotek operation number with its own idempotency key', async () => {
        await useOrderStore().paidOrder(91, 1250, '347');

        expect(api).toHaveBeenCalledWith('/orders/91/paid', {
            method: 'POST',
            headers: { 'Idempotency-Key': 'terminal-paid-91-347' },
            data: { paid_amount: 1250, vendotek_operation_number: '347' },
        });
    });
});
