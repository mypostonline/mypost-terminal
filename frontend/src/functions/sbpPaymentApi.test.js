import { expect, it, vi } from 'vitest';
import api from './api.js';
import { createSbpPayment, getSbpPayment, cancelSbpPayment } from './sbpPaymentApi.js';

vi.mock('./api.js', () => ({ default: vi.fn().mockResolvedValue({}) }));

it('uses the central API with stable idempotency keys and no client amount', async () => {
    const signal = new AbortController().signal;
    await createSbpPayment(91, signal);
    expect(api).toHaveBeenLastCalledWith('/orders/91/payments/sbp', {
        method: 'POST', signal, headers: { 'Idempotency-Key': 'terminal-sbp-91' },
        data: { expires_in_seconds: 600 },
    });
    await getSbpPayment(91, signal);
    expect(api).toHaveBeenLastCalledWith('/orders/91/payments/sbp', { signal });
    await cancelSbpPayment(91, 'p1', signal);
    expect(api).toHaveBeenLastCalledWith('/orders/91/payments/sbp/cancel', {
        method: 'POST', signal, headers: { 'Idempotency-Key': 'terminal-sbp-cancel-91-p1' }, data: { payment_id: 'p1' },
    });
});
