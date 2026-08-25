const DEFAULT_APP_URL = 'https://app.my-post.online';

export const createOrderUrl = ({ orderUuid, appUrl }) => {
    const normalizedOrderUuid = String(orderUuid ?? '').trim();
    const configuredAppUrl = String(appUrl ?? '').trim();
    const normalizedAppUrl = (configuredAppUrl || DEFAULT_APP_URL)
        .replace(/\/+$/, '');

    if (!normalizedOrderUuid || !normalizedAppUrl) {
        return '';
    }

    return `${normalizedAppUrl}/order/${encodeURIComponent(normalizedOrderUuid)}`;
};

export const getOrderUrl = orderUuid => createOrderUrl({
    orderUuid,
    appUrl: import.meta.env.VITE_APP_URL,
});
