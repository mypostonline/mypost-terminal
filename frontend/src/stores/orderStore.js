import { ref } from 'vue'
import { defineStore } from 'pinia'
import api from "@/functions/api.js";

export const useOrderStore = defineStore('orderStore', () => {

    const isLoading = ref(false);
    const order = ref({});

    const statuses = ref({
        created: {
            name: 'Создан',
            color: '#a2cfa3',
        },
        payment: {
            name: 'Оплата',
            color: '#33d334',
        },
        paid: {
            name: 'Оплачен',
            color: '#169617',
        },
        sent: {
            name: 'Ждем ответ',
            color: '#ffb800',
        },
        washing_wait: {
            name: 'Начинаем',
            color: '#ffb800',
        },
        washing: {
            name: 'Робот',
            color: '#169617',
        },
        drying_wait: {
            name: 'Ожидание сухой зоны',
            color: '#169617',
        },
        drying: {
            name: 'Сухая зона',
            color: '#169617',
        },
        completed: {
            name: 'Завершен',
            color: '#169617',
        },
        canceled: {
            name: 'Отменен',
            color: '#ffabab',
        },
        failed: {
            name: 'Завершен',
            color: '#ff3737',
        },
    });


    const setOrder = (data) => {
        order.value = data;
    }

    const getOrder = async (orderId) => {
        orderId = parseInt(orderId);
        const response = await api('/orders/' + orderId);
        isLoading.value = false;
        if (response?.id) {
            setOrder(response);
        }
        return response;
    }

    const createOrder = async (data) => {
        isLoading.value = true;
        const response = await api('/orders', {
            method: 'POST',
            data: data
        });
        isLoading.value = false;
        if (response?.id) {
            setOrder(response);
        }
        return response;
    }

    const paidOrder = async (orderId) => {
        await api('/orders/' + orderId + '/paid', {
            method: 'POST'
        });
    }

    return {
        isLoading,
        order,
        statuses,
        getOrder,
        createOrder,
        paidOrder
    }
})
