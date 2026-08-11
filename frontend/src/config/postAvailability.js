const ORDER_ACCEPTING_STATUSES = new Set([ 'online', 'busy' ]);

export const isPostAcceptingOrders = post => {
    return ORDER_ACCEPTING_STATUSES.has(
        String(post?.status || '').toLowerCase()
    );
};
