export const PAYABLE_ORDER_STATUSES = new Set([ 'created', 'payment' ]);

export const PAID_ORDER_STATUSES = new Set([
    'paid',
    'sent',
    'washing_wait',
    'washing',
    'drying_wait',
    'drying',
    'completed',
]);

export const CLOSED_ORDER_STATUSES = new Set([ 'canceled', 'failed' ]);

export const getOrderStatus = order => {
    const status = order?.status;
    if (typeof status === 'string') {
        return status.toLowerCase();
    }

    return String(
        status?.code ||
        status?.slug ||
        order?.status_code ||
        ''
    ).toLowerCase();
};

export const classifyOrder = order => {
    const status = getOrderStatus(order);

    if (PAYABLE_ORDER_STATUSES.has(status)) {
        return 'payable';
    }
    if (PAID_ORDER_STATUSES.has(status)) {
        return 'paid';
    }
    if (CLOSED_ORDER_STATUSES.has(status)) {
        return 'closed';
    }
    return 'unknown';
};
