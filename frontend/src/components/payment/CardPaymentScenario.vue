<script setup>
import {
    computed,
    onBeforeUnmount,
    onMounted,
    ref,
} from "vue";
import OrderSummaryComponent from "@/components/order/OrderSummaryComponent.vue";
import localApi from "@/functions/localApi.js";

const props = defineProps({
    order: {
        type: Object,
        required: true,
    },
    resumeOnly: {
        type: Boolean,
        default: false,
    },
});

const emit = defineEmits([
    'approved',
    'failed',
    'attention',
    'canceled',
]);

const session = ref(null);
const connectionState = ref('connecting');
const isCanceling = ref(false);
const cancelError = ref('');
const approvedEmitted = ref(false);
const failedEmitted = ref(false);
const attentionEmitted = ref(false);
const canceledEmitted = ref(false);

let socket = null;
let pollTimer = null;
let reconnectTimer = null;
let isUnmounted = false;
let isStarting = false;

const targetAmountMinor = computed(() => {
    return Math.round(Number(props.order.total_amount) * 100);
});

const cardState = computed(() => session.value?.state || 'preparing');
const canCancel = computed(() => {
    return (
        cardState.value === 'processing' &&
        Boolean(session.value?.id) &&
        !isCanceling.value
    );
});
const showCancelAction = computed(() => {
    return canCancel.value ||
        isCanceling.value ||
        cardState.value === 'canceling';
});

const getSocketUrl = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
};

const applySession = nextSession => {
    if (
        isUnmounted ||
        !nextSession ||
        String(nextSession.orderId) !== String(props.order.id)
    ) {
        return;
    }

    session.value = nextSession;

    if (nextSession.state === 'completed' && !approvedEmitted.value) {
        const approvedAmount =
            Number(nextSession.approvedAmountMinor) / 100;
        if (!Number.isFinite(approvedAmount) || approvedAmount <= 0) {
            if (!attentionEmitted.value) {
                attentionEmitted.value = true;
                emit('attention', 'Не удалось определить сумму принятой оплаты');
            }
            return;
        }

        approvedEmitted.value = true;
        emit('approved', approvedAmount);
        return;
    }

    if (nextSession.state === 'declined' && !failedEmitted.value) {
        if (
            nextSession.reason === 'customer_canceled' &&
            !canceledEmitted.value
        ) {
            canceledEmitted.value = true;
            emit('canceled');
            return;
        }

        failedEmitted.value = true;
        emit(
            'failed',
            nextSession.reason === 'customer_timeout'
                ? 'Время ожидания карты истекло'
                : 'Платёж отклонён или отменён'
        );
        return;
    }

    if (
        nextSession.state === 'attention_required' &&
        !attentionEmitted.value
    ) {
        attentionEmitted.value = true;
        emit(
            'attention',
            'Результат операции требует проверки. Не повторяйте оплату'
        );
    }
};

const cancelPayment = async () => {
    if (!canCancel.value) {
        return;
    }

    isCanceling.value = true;
    cancelError.value = '';

    try {
        const data = await localApi('/api/card/cancel', {
            method: 'POST',
            data: {
                sessionId: session.value.id,
                orderId: props.order.id,
            },
        });
        applySession(data.session);
    }
    catch (error) {
        console.error('Failed to cancel card payment', error);
        cancelError.value =
            error.code === 'card_payment_already_approved'
                ? 'Оплата уже подтверждается. Дождитесь результата'
                : 'Не удалось отменить оплату. Попробуйте ещё раз';
        await refreshStatus();
    }
    finally {
        isCanceling.value = false;
    }
};

const refreshStatus = async () => {
    if (isUnmounted) {
        return;
    }

    try {
        const query = new URLSearchParams({
            orderId: props.order.id,
        });
        const data = await localApi(`/api/card/status?${query}`);
        applySession(data.session);
    }
    catch (error) {
        if (error.status !== 404) {
            console.error('Failed to refresh card payment status', error);
        }
    }
};

const scheduleReconnect = () => {
    if (isUnmounted || reconnectTimer) {
        return;
    }

    reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectSocket();
    }, 2_000);
};

const connectSocket = () => {
    if (isUnmounted) {
        return;
    }

    try {
        socket = new WebSocket(getSocketUrl());
    }
    catch (error) {
        console.error('Failed to open card payment socket', error);
        connectionState.value = 'reconnecting';
        scheduleReconnect();
        return;
    }

    socket.addEventListener('open', () => {
        connectionState.value = 'connected';
    });

    socket.addEventListener('message', event => {
        try {
            const message = JSON.parse(event.data);
            if (message.channel === 'card-payment') {
                applySession(message.payload?.session);
            }
            else if (message.channel === 'card-payment-snapshot') {
                applySession(message.payload?.session);
            }
        }
        catch (error) {
            console.error('Invalid card payment event', error);
        }
    });

    socket.addEventListener('close', () => {
        connectionState.value = 'reconnecting';
        scheduleReconnect();
    });

    socket.addEventListener('error', () => {
        connectionState.value = 'reconnecting';
    });
};

const startPayment = async () => {
    if (isStarting) {
        return;
    }

    if (
        !Number.isInteger(targetAmountMinor.value) ||
        targetAmountMinor.value <= 0
    ) {
        emit('failed', 'Некорректная сумма заказа');
        return;
    }

    isStarting = true;
    try {
        const data = await localApi('/api/card/start', {
            method: 'POST',
            data: {
                orderId: props.order.id,
                amountMinor: targetAmountMinor.value,
                productId: props.order.program_id || 1,
                productName: 'WASH',
            },
        });
        applySession(data.session);
        pollTimer = window.setInterval(refreshStatus, 2_000);
    }
    catch (error) {
        console.error('Failed to start card payment', error);

        if (error.code === 'card_payment_busy') {
            session.value = {
                orderId: props.order.id,
                state: 'attention_required',
            };
            if (!attentionEmitted.value) {
                attentionEmitted.value = true;
                emit(
                    'attention',
                    'Платёжный терминал уже выполняет операцию. Вызовите оператора'
                );
            }
        }
        else if (!failedEmitted.value) {
            failedEmitted.value = true;
            emit('failed', 'Платёжный терминал недоступен');
        }
    }
};

const resumePayment = async () => {
    try {
        const query = new URLSearchParams({
            orderId: props.order.id,
        });
        const data = await localApi(`/api/card/status?${query}`);
        if (!data.session) {
            throw new Error('Card payment session is missing');
        }
        applySession(data.session);
        pollTimer = window.setInterval(refreshStatus, 2_000);
    }
    catch (error) {
        console.error('Failed to resume card payment', error);
        session.value = {
            orderId: props.order.id,
            state: 'attention_required',
        };
        if (!attentionEmitted.value) {
            attentionEmitted.value = true;
            emit(
                'attention',
                'Не удалось восстановить платёжную операцию. Вызовите оператора'
            );
        }
    }
};

onMounted(() => {
    connectSocket();
    if (props.resumeOnly) {
        resumePayment();
    }
    else {
        startPayment();
    }
});

onBeforeUnmount(() => {
    isUnmounted = true;
    if (pollTimer) {
        window.clearInterval(pollTimer);
    }
    if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
    }
    if (socket) {
        socket.close();
    }
});
</script>

<template>
    <section aria-live="polite">
        <div class="text-center">
            <svg class="__svg payment-status-icon">
                <use xlink:href="#clock-waiting"></use>
            </svg>
            <h2 class="mt-4">
                {{
                    cardState === 'finalizing'
                        ? 'Подтверждаем оплату'
                        : cardState === 'canceling'
                            ? 'Отменяем оплату'
                        : cardState === 'attention_required'
                            ? 'Требуется помощь оператора'
                            : 'Принимаем оплату картой'
                }}
            </h2>
        </div>

        <order-summary-component :order="order" />

        <div
            class="payment-instruction mt-6"
            :class="{ '--attention': cardState === 'attention_required' }"
        >
            <div class="payment-instruction-title">
                <template v-if="cardState === 'finalizing'">
                    Не прикладывайте карту повторно, операция завершается
                </template>
                <template v-else-if="cardState === 'canceling'">
                    Дождитесь подтверждения отмены от платёжного терминала
                </template>
                <template v-else-if="cardState === 'attention_required'">
                    Не начинайте новую оплату. Вызовите оператора
                </template>
                <template v-else>
                    Приложите карту или телефон к терминалу NFC
                </template>
            </div>
            <svg class="__svg card-payment-icon">
                <use xlink:href="#nfc"></use>
            </svg>
        </div>

        <div
            v-if="connectionState === 'reconnecting'"
            class="payment-connection mt-4"
        >
            Восстанавливаем связь с платёжным терминалом…
        </div>

        <div v-if="showCancelAction" class="payment-cancel-actions mt-6">
            <button
                type="button"
                class="__button"
                :disabled="isCanceling || cardState === 'canceling'"
                @click="cancelPayment"
            >
                {{
                    isCanceling || cardState === 'canceling'
                        ? 'Отменяем оплату…'
                        : 'Отменить и начать заново'
                }}
            </button>
        </div>
        <div
            v-if="cancelError"
            class="payment-cancel-error mt-4"
            aria-live="assertive"
        >
            {{ cancelError }}
        </div>
    </section>
</template>

<style scoped>
.payment-status-icon {
    width: 4rem;
    height: 4rem;
    fill: var(--green-color);
}

.payment-instruction {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem;
    border-radius: 0.75rem;
    text-align: center;
}

.payment-instruction.--attention {
    background: #fff5f1;
    color: #b63d12;
}

.payment-instruction-title {
    font-weight: 600;
}

.card-payment-icon {
    width: 10rem;
    height: 7rem;
    fill: var(--green-color);
}

.payment-connection {
    text-align: center;
    font-size: 0.65rem;
    font-weight: 600;
}

.payment-cancel-actions {
    display: flex;
    justify-content: center;
}

.payment-cancel-error {
    color: #b63d12;
    text-align: center;
    font-size: 0.7rem;
    font-weight: 600;
}
</style>
