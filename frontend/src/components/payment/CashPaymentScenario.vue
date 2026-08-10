<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
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
    'change-credit',
    'failed',
    'attention',
    'canceled',
]);

const session = ref(null);
const connectionState = ref('connecting');
const isStarting = ref(false);
const isCanceling = ref(false);
const cancelError = ref('');
const isReadingBill = ref(false);
const approvedEmitted = ref(false);
const changeCreditEmitted = ref(false);
const failedEmitted = ref(false);
const attentionEmitted = ref(false);
const canceledEmitted = ref(false);

let socket = null;
let pollTimer = null;
let reconnectTimer = null;
let isUnmounted = false;

const targetAmountMinor = computed(() => {
    return Math.round(Number(props.order.total_amount) * 100);
});

const acceptedAmountMinor = computed(() => {
    return Number(session.value?.acceptedAmountMinor || 0);
});

const remainingAmountMinor = computed(() => {
    return Number(
        session.value?.remainingAmountMinor ?? targetAmountMinor.value
    );
});

const acceptedBills = computed(() => {
    return Array.isArray(session.value?.bills) ? session.value.bills : [];
});

const cashState = computed(() => session.value?.state || 'preparing');
const canCancel = computed(() => {
    return (
        [ 'preparing', 'accepting' ].includes(cashState.value) &&
        acceptedAmountMinor.value === 0 &&
        !isReadingBill.value &&
        !isCanceling.value
    );
});
const showCancelAction = computed(() => {
    return canCancel.value || isCanceling.value;
});

const formatMoney = (amountMinor) => {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(Number(amountMinor || 0) / 100);
};

const getSocketUrl = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
};

const failureMessage = (sessionState) => {
    if (sessionState?.error === 'cash_payment_timeout') {
        return 'Время ожидания истекло. Купюры не были внесены';
    }

    if (sessionState?.state === 'canceled') {
        return 'Оплата наличными отменена';
    }

    return 'Купюроприёмник недоступен. Выберите другой способ оплаты';
};

const applySession = (nextSession) => {
    if (
        isUnmounted ||
        !nextSession ||
        String(nextSession.orderId) !== String(props.order.id)
    ) {
        return;
    }

    session.value = nextSession;

    if (
        nextSession.state === 'completed' &&
        Number(nextSession.changeCredit?.amountMinor) > 0 &&
        !changeCreditEmitted.value
    ) {
        changeCreditEmitted.value = true;
        emit('change-credit', nextSession.changeCredit);
    }

    if (nextSession.state === 'completed' && !approvedEmitted.value) {
        approvedEmitted.value = true;
        emit('approved', Number(nextSession.acceptedAmountMinor) / 100);
        return;
    }

    if (
        nextSession.state === 'canceled' &&
        !canceledEmitted.value
    ) {
        canceledEmitted.value = true;
        emit('canceled');
        return;
    }

    if (nextSession.state === 'failed' && !failedEmitted.value) {
        failedEmitted.value = true;
        emit('failed', failureMessage(nextSession));
        return;
    }

    if (
        nextSession.state === 'attention_required' &&
        !attentionEmitted.value
    ) {
        attentionEmitted.value = true;
        emit(
            'attention',
            nextSession.error === 'bill_amount_unrecognized'
                ? 'Не удалось распознать номинал купюры. Не вносите новые купюры и вызовите оператора'
                : 'Купюры приняты не полностью. Не начинайте новую оплату'
        );
    }
};

const cancelPayment = async () => {
    if (!canCancel.value || !session.value?.id) {
        return;
    }

    isCanceling.value = true;
    cancelError.value = '';

    try {
        const data = await localApi('/api/cash/cancel', {
            method: 'POST',
            data: {
                sessionId: session.value.id,
            },
        });
        applySession(data.session);
    }
    catch (error) {
        console.error('Failed to cancel cash payment', error);
        cancelError.value =
            error.code === 'cash_bill_processing'
                ? 'Купюра обрабатывается. Дождитесь обновления суммы'
                : error.code === 'cash_already_accepted'
                    ? 'Отмена невозможна: купюра уже принята'
                    : 'Не удалось отменить оплату. Попробуйте ещё раз';
        await refreshStatus();
    }
    finally {
        isCanceling.value = false;
    }
};

const refreshStatus = async () => {
    if (!session.value?.id || isUnmounted) {
        return;
    }

    try {
        const query = new URLSearchParams({
            sessionId: session.value.id,
        });
        const data = await localApi(`/api/cash/status?${query}`);
        applySession(data.session);
    }
    catch (error) {
        console.error('Failed to refresh cash payment status', error);
    }
};

const scheduleReconnect = () => {
    if (isUnmounted || reconnectTimer) {
        return;
    }

    reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectSocket();
    }, 2000);
};

const connectSocket = () => {
    if (isUnmounted) {
        return;
    }

    try {
        socket = new WebSocket(getSocketUrl());
    }
    catch (error) {
        console.error('Failed to open cash payment socket', error);
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

            if (message.channel === 'cash-payment') {
                if (
                    [
                        'bill_accepted',
                        'completed',
                        'failed',
                        'attention_required',
                    ].includes(message.payload?.event)
                ) {
                    isReadingBill.value = false;
                }
                applySession(message.payload?.session);
            }
            else if (message.channel === 'cash-payment-snapshot') {
                applySession(message.payload?.session);
            }
            else if (
                message.channel === 'bill-acceptor-pulse' &&
                cashState.value === 'accepting'
            ) {
                isReadingBill.value = true;
            }
        }
        catch (error) {
            console.error('Invalid cash payment event', error);
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
    if (isStarting.value) {
        return;
    }

    if (
        !Number.isInteger(targetAmountMinor.value) ||
        targetAmountMinor.value <= 0
    ) {
        emit('failed', 'Некорректная сумма заказа');
        return;
    }

    isStarting.value = true;

    try {
        const data = await localApi('/api/cash/start', {
            method: 'POST',
            data: {
                orderId: props.order.id,
                amountMinor: targetAmountMinor.value,
            },
        });
        applySession(data.session);

        pollTimer = window.setInterval(refreshStatus, 2000);
    }
    catch (error) {
        console.error('Failed to start cash payment', error);

        if (!failedEmitted.value) {
            failedEmitted.value = true;
            emit(
                'failed',
                error.code === 'cash_payment_busy'
                    ? 'Купюроприёмник занят. Вызовите оператора'
                    : 'Купюроприёмник недоступен. Выберите другой способ оплаты'
            );
        }
    }
};

const resumePayment = async () => {
    try {
        const data = await localApi('/api/cash/status');
        if (
            !data.session ||
            String(data.session.orderId) !== String(props.order.id)
        ) {
            throw new Error('Cash payment session is missing');
        }
        applySession(data.session);
        pollTimer = window.setInterval(refreshStatus, 2_000);
    }
    catch (error) {
        console.error('Failed to resume cash payment', error);
        session.value = {
            orderId: props.order.id,
            state: 'attention_required',
            acceptedAmountMinor: 0,
            remainingAmountMinor: targetAmountMinor.value,
        };
        if (!attentionEmitted.value) {
            attentionEmitted.value = true;
            emit(
                'attention',
                'Не удалось восстановить приём наличных. Вызовите оператора'
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
                {{ cashState === 'accepting' ? 'Внесите наличные' : 'Оплата наличными' }}
            </h2>
        </div>

        <order-summary-component :order="order" />

        <div
            class="cash-device-status mt-6"
            :class="{ '--attention': cashState === 'attention_required' }"
        >
            <span class="cash-device-icon">
                <svg class="__svg">
                    <use xlink:href="#cash"></use>
                </svg>
            </span>

            <span v-if="cashState === 'accepting'" class="cash-device-content">
                <strong>
                    {{
                        connectionState === 'connected'
                            ? isReadingBill
                                ? 'Считываем купюру…'
                                : 'Купюроприёмник готов'
                            : 'Восстанавливаем связь'
                    }}
                </strong>
                <span>
                    {{
                        connectionState !== 'connected'
                            ? 'Пока не вносите новые купюры'
                            : isReadingBill
                            ? 'Дождитесь обновления внесённой суммы'
                            : 'Вставляйте купюры по одной'
                    }}
                </span>
            </span>

            <span
                v-else-if="cashState === 'attention_required'"
                class="cash-device-content"
            >
                <strong>Требуется помощь оператора</strong>
                <span>Не вносите новые купюры и не начинайте оплату заново</span>
            </span>

            <span v-else class="cash-device-content">
                <strong>Подготавливаем купюроприёмник</strong>
                <span>Пока не вносите купюры</span>
            </span>
        </div>

        <div
            v-if="[ 'accepting', 'attention_required' ].includes(cashState)"
            class="cash-progress mt-6"
        >
            <div class="cash-progress-row">
                <span>Внесено</span>
                <strong>{{ formatMoney(acceptedAmountMinor) }}</strong>
            </div>
            <div class="cash-progress-row --remaining">
                <span>Осталось внести</span>
                <strong>{{ formatMoney(remainingAmountMinor) }}</strong>
            </div>
            <div v-if="acceptedBills.length" class="cash-bills-summary">
                Принято купюр: {{ acceptedBills.length }} · Последняя:
                {{ formatMoney(acceptedBills.at(-1)?.amountMinor) }}
            </div>
            <div class="cash-no-change">Терминал не выдаёт сдачу</div>
        </div>

        <div
            v-if="connectionState === 'reconnecting' && cashState === 'accepting'"
            class="cash-connection mt-4"
        >
            Восстанавливаем связь с купюроприёмником…
        </div>

        <div v-if="showCancelAction" class="payment-cancel-actions mt-6">
            <button
                type="button"
                class="__button"
                :disabled="isCanceling"
                @click="cancelPayment"
            >
                {{
                    isCanceling
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

.cash-device-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0.85rem;
    border: 0.12rem solid rgba(34, 64, 98, 0.14);
    border-radius: 0.85rem;
    background: #ffffff;
    box-shadow: 0 0.25rem 0.5rem rgba(0, 0, 0, 0.18);
}

.cash-device-status.--attention {
    border-color: #e8541e;
    background: #fff5f1;
}

.cash-device-icon {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 3.25rem;
    height: 3.25rem;
    border-radius: 50%;
    background: var(--green-color);
}

.--attention .cash-device-icon {
    background: #e8541e;
}

.cash-device-icon .__svg {
    width: 1.75rem;
    height: 1.75rem;
    fill: #ffffff;
}

.cash-device-content {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.65rem;
}

.cash-device-content strong {
    font-size: 0.8rem;
}

.cash-progress {
    display: grid;
    gap: 0.65rem;
    padding: 1rem;
    border-radius: 0.85rem;
    background: #ffffff;
    box-shadow: 0 0.25rem 0.5rem rgba(0, 0, 0, 0.12);
}

.cash-progress-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.75rem;
}

.cash-progress-row strong {
    font-size: 1rem;
}

.cash-progress-row.--remaining {
    padding-top: 0.65rem;
    border-top: 0.08rem solid rgba(34, 64, 98, 0.12);
}

.cash-progress-row.--remaining strong {
    color: var(--green-color);
}

.cash-no-change,
.cash-bills-summary,
.cash-connection {
    text-align: center;
    font-size: 0.65rem;
    font-weight: 600;
}

.cash-bills-summary {
    color: rgba(34, 64, 98, 0.78);
}

.cash-no-change {
    color: #e8541e;
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
