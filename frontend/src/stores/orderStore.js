import { ref } from 'vue';
import { defineStore } from 'pinia';
import api, { ApiError } from '@/functions/api.js';

const normalizeOrderId = orderId => {
    const id = Number.parseInt(orderId, 10);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Некорректный номер заказа');
    }
    return id;
};

export const useOrderStore = defineStore('orderStore', () => {
    const isLoading = ref(false);
    const order = ref({});

    const statuses = ref({
        created: { name: 'Создан', color: '#a2cfa3' },
        payment: { name: 'Оплата', color: '#33d334' },
        paid: { name: 'Оплачен', color: '#169617' },
        sent: { name: 'Ждём ответ', color: '#ffb800' },
        washing_wait: { name: 'Начинаем', color: '#ffb800' },
        washing: { name: 'Робот', color: '#169617' },
        drying_wait: {
            name: 'Ожидание сухой зоны',
            color: '#169617',
        },
        drying: { name: 'Сухая зона', color: '#169617' },
        completed: { name: 'Завершён', color: '#169617' },
        canceled: { name: 'Отменён', color: '#ffabab' },
        failed: { name: 'Ошибка', color: '#ff3737' },
    });

    const setOrder = data => {
        order.value = data || {};
    };

    const clearOrder = () => {
        order.value = {};
    };

    const getOrder = async orderId => {
        const id = normalizeOrderId(orderId);
        isLoading.value = true;
        clearOrder();

        try {
            const response = await api(`/orders/${id}`);
            if (response?.id) {
                setOrder(response);
            }
            return response;
        }
        finally {
            isLoading.value = false;
        }
    };

    const createOrder = async (data, { requestId } = {}) => {
        isLoading.value = true;

        try {
            const response = await api('/orders', {
                method: 'POST',
                headers: requestId
                    ? { 'Idempotency-Key': requestId }
                    : undefined,
                data: {
                    ...data,
                    ...(requestId
                        ? { client_request_id: requestId }
                        : {}),
                },
            });
            if (response?.id) {
                setOrder(response);
            }
            return response;
        }
        finally {
            isLoading.value = false;
        }
    };

    const paidOrder = async (orderId, paidAmount) => {
        const id = normalizeOrderId(orderId);
        const response = await api(`/orders/${id}/paid`, {
            method: 'POST',
            headers: {
                'Idempotency-Key': `terminal-order-paid-${id}`,
            },
            data: { paid_amount: paidAmount },
        });

        if (response?.success === false || response?.error) {
            throw new ApiError(
                response.message ||
                    response.error ||
                    'Не удалось подтвердить оплату заказа',
                {
                    code: response.error || 'order_payment_update_failed',
                    data: response,
                }
            );
        }

        return response;
    };

    return {
        isLoading,
        order,
        statuses,
        setOrder,
        clearOrder,
        getOrder,
        createOrder,
        paidOrder,
    };
});
