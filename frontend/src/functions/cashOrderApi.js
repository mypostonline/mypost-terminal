import api from './api.js';

const BILL_PATH_TEMPLATE = import.meta.env.VITE_CASH_BILL_PATH_TEMPLATE ||
    '/orders/{orderId}/cash/bills';
const BALANCE_CREDIT_PATH_TEMPLATE =
    import.meta.env.VITE_CASH_BALANCE_CREDIT_PATH_TEMPLATE ||
    '/orders/{orderId}/cash/credit';

const buildOrderPath = (template, orderId) => {
    return template.replace(
        '{orderId}',
        encodeURIComponent(String(orderId))
    );
};

export const createCashBillPayload = ({ sessionId, bill }) => ({
    cash_session_id: String(sessionId),
    bill_id: String(bill.id),
    sequence: Number(bill.sequence),
    amount: Number(bill.amountMinor) / 100,
    accepted_at: bill.acceptedAt,
});

export const recordCashBill = ({ orderId, sessionId, bill }) => {
    return api(buildOrderPath(BILL_PATH_TEMPLATE, orderId), {
        method: 'POST',
        headers: {
            'Idempotency-Key': `terminal-cash-bill-${bill.id}`,
        },
        data: createCashBillPayload({ sessionId, bill }),
    });
};

export const createBalanceCreditPayload = ({ session }) => ({
    cash_session_id: String(session.id),
    amount: Number(session.acceptedAmountMinor) / 100,
    bills: (session.bills || []).map(bill => (
        createCashBillPayload({ sessionId: session.id, bill })
    )),
});

export const creditCashToBalance = ({ orderId, session }) => {
    return api(buildOrderPath(BALANCE_CREDIT_PATH_TEMPLATE, orderId), {
        method: 'POST',
        headers: {
            'Idempotency-Key': `terminal-cash-credit-${session.id}`,
        },
        data: createBalanceCreditPayload({ session }),
    });
};
