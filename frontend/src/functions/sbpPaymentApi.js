import api from './api.js';

export const SBP_PAYMENT_TIMEOUT_SECONDS = 600;

const path = orderId => `/orders/${encodeURIComponent(String(orderId))}/payments/sbp`;

export const createSbpPayment = (orderId, signal) => api(path(orderId), {
    method: 'POST', signal,
    headers: { 'Idempotency-Key': `terminal-sbp-${orderId}` },
    data: { expires_in_seconds: SBP_PAYMENT_TIMEOUT_SECONDS },
});

export const getSbpPayment = (orderId, signal) => api(path(orderId), { signal });

export const cancelSbpPayment = (orderId, paymentId, signal) => api(`${path(orderId)}/cancel`, {
    method: 'POST', signal,
    headers: { 'Idempotency-Key': `terminal-sbp-cancel-${orderId}-${paymentId}` },
    data: { payment_id: paymentId },
});
