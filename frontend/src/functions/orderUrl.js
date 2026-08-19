const DEFAULT_APP_URL = 'https://app.my-post.online';

export const createOrderUrl = ({ orderId, appUrl }) => {
    const normalizedOrderId = String(orderId ?? '').trim();
    const configuredAppUrl = String(appUrl ?? '').trim();
    const normalizedAppUrl = (configuredAppUrl || DEFAULT_APP_URL)
        .replace(/\/+$/, '');

    if (!normalizedOrderId || !normalizedAppUrl) {
        return '';
    }

    return `${normalizedAppUrl}/order/${encodeURIComponent(normalizedOrderId)}`;
};

export const getOrderUrl = orderId => createOrderUrl({
    orderId,
    appUrl: import.meta.env.VITE_APP_URL,
});
