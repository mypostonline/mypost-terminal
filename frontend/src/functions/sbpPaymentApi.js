import api from './api.js';

const path = orderId => `/orders/${encodeURIComponent(String(orderId))}/payments/sbp`;

export const createSbpPayment = (orderId, signal) => api(path(orderId), {
    method: 'POST', signal,
    headers: { 'Idempotency-Key': `terminal-sbp-${orderId}` },
});

export const getSbpPayment = (orderId, signal) => api(path(orderId), { signal });

export const cancelSbpPayment = (orderId, paymentId, signal) => api(`${path(orderId)}/cancel`, {
    method: 'POST', signal,
    headers: { 'Idempotency-Key': `terminal-sbp-cancel-${orderId}-${paymentId}` },
    data: { payment_id: paymentId },
});
