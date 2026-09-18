<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import OrderSummaryComponent from '@/components/order/OrderSummaryComponent.vue';
import { createSbpPayment, getSbpPayment, cancelSbpPayment } from '@/functions/sbpPaymentApi.js';
import { getQrImageUrl } from '@/functions/qrUrl.js';
import { formatCountdown, getSecondsUntil } from '@/functions/paymentTimer.js';
import { getOrderStatus, PAID_ORDER_STATUSES } from '@/config/orderStatuses.js';
import vRandomQrAnimation from '@/directives/randomQrAnimation.js';

const props = defineProps({ order: { type: Object, required: true }, resumeOnly: Boolean });
const emit = defineEmits(['server-paid', 'failed', 'canceled']);
const payment = ref(null);
const error = ref('');
const imageError = ref(false);
const imageLoaded = ref(false);
const busy = ref(false);
const now = ref(Date.now());
let stopped = false;
let finished = false;
let pollTimer;
let clockTimer;
const controller = new AbortController();
const secondsLeft = computed(() => getSecondsUntil(payment.value?.expires_at, now.value));
const qrImage = computed(() => payment.value?.status === 'pending' && secondsLeft.value > 0
    ? getQrImageUrl(payment.value.qr_payload) : '');

const applyResponse = response => {
    const next = response?.payment;
    const expectedMinor = Math.round(Number(props.order.total_amount) * 100);
    if (!next?.id || String(next.order_id) !== String(props.order.id) ||
        next.currency !== 'RUB' || !Number.isSafeInteger(next.amount_minor) ||
        expectedMinor <= 0 || next.amount_minor !== expectedMinor ||
        !['pending', 'paid', 'expired', 'canceled', 'failed'].includes(next.status)) {
        throw new Error('Некорректный ответ сервера СБП. Проверяем статус — не оплачивайте повторно.');
    }
    if (next.status === 'pending' && (!next.qr_payload || typeof next.qr_payload !== 'string' ||
        !Number.isFinite(Date.parse(next.expires_at)))) {
        throw new Error('Сервер не вернул платёжный QR-код или срок его действия.');
    }
    if (next.qr_payload !== payment.value?.qr_payload) {
        imageError.value = false;
        imageLoaded.value = false;
    }
    payment.value = next;
    if (next.status === 'paid') {
        const order = response.order;
        if (String(order?.id) !== String(props.order.id) || !PAID_ORDER_STATUSES.has(getOrderStatus(order))) {
            throw new Error('Оплата подтверждается сервером. Не оплачивайте повторно.');
        }
        finished = true;
        emit('server-paid', order);
    } else if (next.status === 'canceled') {
        finished = true;
        emit('canceled');
    } else if (['expired', 'failed'].includes(next.status)) {
        finished = true;
        emit('failed', next.status === 'expired' ? 'Время оплаты по СБП истекло' : 'Оплата по СБП не выполнена');
    }
};

const schedulePoll = () => {
    window.clearTimeout(pollTimer);
    if (!stopped && !finished) pollTimer = window.setTimeout(() => request('status'), 2000);
};

const request = async kind => {
    if (busy.value || stopped || finished) return;
    busy.value = true;
    error.value = '';
    window.clearTimeout(pollTimer);
    try {
        const response = kind === 'create'
            ? await createSbpPayment(props.order.id, controller.signal)
            : kind === 'cancel'
                ? await cancelSbpPayment(props.order.id, payment.value.id, controller.signal)
                : await getSbpPayment(props.order.id, controller.signal);
        if (!stopped) applyResponse(response);
    } catch (requestError) {
        if (!stopped) error.value = kind === 'create'
            ? 'Не удалось получить QR-код СБП. Повторите запрос или вызовите оператора.'
            : requestError.message || 'Не удалось проверить оплату. Не оплачивайте повторно — восстанавливаем связь.';
    } finally {
        busy.value = false;
        // A failed create can still have created a payment: check before retrying.
        schedulePoll();
    }
};

const actions = computed(() => {
    if (finished) return [];
    if (!payment.value) return [{ id: 'sbp-retry', label: 'Повторить запрос СБП', disabled: busy.value, run: () => request('create') }];
    if (payment.value.status !== 'pending') return [];
    return [{ id: 'cancel', label: 'Отменить и начать заново', disabled: busy.value, run: () => request('cancel') }];
});
defineExpose({ actions });

onMounted(() => {
    clockTimer = window.setInterval(() => { now.value = Date.now(); }, 1000);
    // Idempotent create also recovers an existing payment after navigation/reload.
    request('create');
});
onBeforeUnmount(() => {
    stopped = true;
    controller.abort();
    window.clearTimeout(pollTimer);
    window.clearInterval(clockTimer);
});
</script>

<template>
    <section class="sbp-payment">
        <h2>Оплата по СБП</h2>
        <OrderSummaryComponent :order="order" />
        <div v-if="qrImage" class="sbp-payment-qr">
            <p>Отсканируйте QR-код в приложении вашего банка и подтвердите оплату.</p>
            <div
                v-if="!imageError"
                v-random-qr-animation
                class="sbp-payment-qr-image"
                :class="{
                    '--loaded': imageLoaded,
                    'qr-code-frame': imageLoaded,
                }"
            >
                <img
                    v-show="imageLoaded"
                    :src="qrImage"
                    alt="QR-код для оплаты по СБП"
                    @load="imageLoaded = true"
                    @error="imageError = true"
                >
                <p v-if="!imageLoaded" role="status">Загружаем QR-код для оплаты…</p>
            </div>
            <p v-else role="alert">Не удалось загрузить QR-код. Вызовите оператора.</p>
            <p>Время на оплату: <strong>{{ formatCountdown(secondsLeft) }}</strong></p>
        </div>
        <p v-else role="status">{{ payment ? 'Проверяем итоговый статус оплаты… Не оплачивайте повторно.' : 'Получаем QR-код для оплаты…' }}</p>
        <p v-if="error" class="sbp-payment-error" role="alert">{{ error }}</p>
    </section>
</template>

<style scoped>
.sbp-payment { text-align: center; }
.sbp-payment-qr { display: grid; justify-items: center; gap: 0.6rem; margin-top: 1rem; }
.sbp-payment-qr-image { display: grid; place-items: center; width: min(100%, 17rem); }
.sbp-payment-error { margin-top: 0.75rem; color: #b63d12; }
</style>
