<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import OrderSummaryComponent from "@/components/order/OrderSummaryComponent.vue";
import CallSupportComponent from "@/components/CallSupportComponent.vue";
import localApi from "@/functions/localApi.js";
import {
    creditCashToBalance,
    recordCashBill,
} from "@/functions/cashOrderApi.js";
import {
    formatCountdown,
    getSecondsUntil,
} from "@/functions/paymentTimer.js";

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
    'balance-credit-ready',
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
const isMockMode = ref(false);
const mockAmountsRub = ref([]);
const isMockInserting = ref(false);
const mockError = ref('');
const isResuming = ref(false);
const isCreditingBalance = ref(false);
const balanceCreditError = ref('');
const billSyncError = ref('');
const countdownNowMs = ref(Date.now());
const approvedEmitted = ref(false);
const balanceCreditEmitted = ref(false);
const failedEmitted = ref(false);
const attentionEmitted = ref(false);
const canceledEmitted = ref(false);

let socket = null;
let pollTimer = null;
let reconnectTimer = null;
let countdownTimer = null;
let isUnmounted = false;
const COUNTDOWN_REFRESH_INTERVAL_MS = 200;
const recordedBillIds = new Set();
const recordingBillIds = new Set();
const attemptedBalanceCreditSessions = new Set();

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

const cashState = computed(() => session.value?.state || 'preparing');
const isPartialPayment = computed(() => cashState.value === 'partial_payment');
const isBalanceCredit = computed(() => (
    [ 'balance_credit_required', 'balance_credit_ready' ].includes(
        cashState.value
    )
));
const decisionSecondsLeft = computed(() => getSecondsUntil(
    session.value?.decisionDeadlineAt,
    countdownNowMs.value
));
const acceptanceSecondsLeft = computed(() => getSecondsUntil(
    session.value?.acceptanceDeadlineAt,
    countdownNowMs.value
));
const decisionTimeLabel = computed(() => (
    formatCountdown(decisionSecondsLeft.value)
));
const acceptanceTimeLabel = computed(() => (
    formatCountdown(acceptanceSecondsLeft.value)
));
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
        return 'Время ожидания истекло';
    }

    if (sessionState?.state === 'canceled') {
        return 'Оплата наличными отменена';
    }

    return 'Купюроприёмник недоступен. Выберите другой способ оплаты';
};

const synchronizeBills = nextSession => {
    for (const bill of nextSession?.bills || []) {
        if (
            !bill?.id ||
            recordedBillIds.has(bill.id) ||
            recordingBillIds.has(bill.id)
        ) {
            continue;
        }

        recordingBillIds.add(bill.id);
        recordCashBill({
            orderId: props.order.id,
            sessionId: nextSession.id,
            bill,
        }).then(() => {
            recordedBillIds.add(bill.id);
            billSyncError.value = '';
        }).catch(error => {
            console.error('Failed to record accepted cash bill', error);
            billSyncError.value =
                'Повторяем фиксацию принятой купюры на сервере…';
        }).finally(() => {
            recordingBillIds.delete(bill.id);
        });
    }
};

const confirmLocalBalanceCredit = async ({ sessionId }) => {
    return localApi('/api/cash/balance-credit/confirm', {
        method: 'POST',
        data: { sessionId },
    });
};

const creditPartialBalance = async (
    sourceSession = session.value,
    { force = false } = {}
) => {
    if (
        !sourceSession?.id ||
        ![ 'partial_payment', 'balance_credit_required' ].includes(
            sourceSession.state
        ) ||
        isCreditingBalance.value
    ) {
        return;
    }
    if (
        !force &&
        attemptedBalanceCreditSessions.has(sourceSession.id)
    ) {
        return;
    }

    attemptedBalanceCreditSessions.add(sourceSession.id);
    isCreditingBalance.value = true;
    balanceCreditError.value = '';

    try {
        let creditSession = sourceSession;
        if (sourceSession.state === 'partial_payment') {
            const requested = await localApi(
                '/api/cash/balance-credit/request',
                {
                    method: 'POST',
                    data: { sessionId: sourceSession.id },
                }
            );
            creditSession = requested.session;
            applyStatus(requested);
        }

        await creditCashToBalance({
            orderId: props.order.id,
            session: creditSession,
        });

        if (isUnmounted || session.value?.state === 'released') {
            return;
        }

        const confirmed = await confirmLocalBalanceCredit({
            sessionId: creditSession.id,
        });
        applyStatus(confirmed);
    }
    catch (error) {
        console.error('Failed to credit partial cash payment', error);
        balanceCreditError.value =
            'Не удалось подготовить зачисление на баланс. Повторите попытку или вызовите оператора';
        await refreshStatus();
    }
    finally {
        isCreditingBalance.value = false;
    }
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
    if (nextSession.state !== 'accepting') {
        isReadingBill.value = false;
    }
    countdownNowMs.value = Date.now();
    synchronizeBills(nextSession);

    if (nextSession.state === 'balance_credit_required') {
        creditPartialBalance(nextSession);
    }

    if (nextSession.state === 'completed' && !approvedEmitted.value) {
        approvedEmitted.value = true;
        emit('approved', Number(nextSession.acceptedAmountMinor) / 100);
        return;
    }

    if (
        nextSession.state === 'balance_credit_ready' &&
        !balanceCreditEmitted.value
    ) {
        balanceCreditEmitted.value = true;
        emit('balance-credit-ready');
        return;
    }

    if (
        [ 'canceled', 'released' ].includes(nextSession.state) &&
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
            nextSession.error?.startsWith('cash_fiscalization_')
                ? 'Деньги приняты, но Vendotek не подтвердил фискализацию. Не повторяйте оплату и вызовите оператора'
                : nextSession.error === 'bill_amount_unrecognized'
                    ? 'Не удалось распознать номинал купюры. Не вносите новые купюры и вызовите оператора'
                    : 'Купюры приняты не полностью. Не начинайте новую оплату'
        );
    }
};

const resumePartialPayment = async () => {
    if (!isPartialPayment.value || !session.value?.id || isResuming.value) {
        return;
    }

    isResuming.value = true;
    balanceCreditError.value = '';
    try {
        const data = await localApi('/api/cash/resume', {
            method: 'POST',
            data: { sessionId: session.value.id },
        });
        applyStatus(data);
    }
    catch (error) {
        console.error('Failed to resume partial cash payment', error);
        balanceCreditError.value =
            'Не удалось продолжить приём купюр. Повторите попытку или вызовите оператора';
        await refreshStatus();
    }
    finally {
        isResuming.value = false;
    }
};

const applyStatus = data => {
    if (data?.acceptor) {
        isMockMode.value = data.acceptor.testMode === true;
        mockAmountsRub.value = Array.isArray(
            data.acceptor.supportedAmountsRub
        )
            ? data.acceptor.supportedAmountsRub
            : [];
    }
    applySession(data?.session);
};

const insertMockBill = async amountMinor => {
    if (
        !isMockMode.value ||
        cashState.value !== 'accepting' ||
        isMockInserting.value
    ) {
        return;
    }

    isMockInserting.value = true;
    mockError.value = '';
    try {
        const data = await localApi('/api/cash/mock/insert', {
            method: 'POST',
            data: { amountMinor: Number(amountMinor) },
        });
        applyStatus(data);
    }
    catch (error) {
        console.error('Failed to insert mock bill', error);
        mockError.value = 'Не удалось внести тестовую купюру';
        await refreshStatus();
    }
    finally {
        isMockInserting.value = false;
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
        applyStatus(data);
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
        applyStatus(data);
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
                        'partial_payment',
                        'resumed',
                        'balance_credit_required',
                        'balance_credit_ready',
                        'released',
                        'attention_required',
                    ].includes(message.payload?.event)
                ) {
                    isReadingBill.value = false;
                }
                applySession(message.payload?.session);
            }
            else if (message.channel === 'cash-payment-snapshot') {
                applyStatus(message.payload);
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
                productId: props.order.program_id || 1,
            },
        });
        applyStatus(data);

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
                    : error.code === 'cash_fiscalizer_unavailable'
                        ? 'Касса Vendotek недоступна. Выберите оплату картой или вызовите оператора'
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
        applyStatus(data);
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
    countdownTimer = window.setInterval(() => {
        countdownNowMs.value = Date.now();
    }, COUNTDOWN_REFRESH_INTERVAL_MS);
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
    if (countdownTimer) {
        window.clearInterval(countdownTimer);
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
                    cashState === 'accepting'
                        ? 'Внесите наличные'
                        : cashState === 'fiscalizing'
                            ? 'Формируем кассовый чек'
                        : isPartialPayment
                            ? 'Оплата приостановлена'
                            : isBalanceCredit
                                ? 'Зачисление на баланс'
                                : 'Оплата наличными'
                }}
            </h2>
        </div>

        <order-summary-component :order="order" />

        <div
            class="cash-device-status mt-6"
            :class="{
                '--attention': cashState === 'attention_required',
            }"
        >
            <span class="cash-device-icon">
                <svg class="__svg">
                    <use xlink:href="#cash"></use>
                </svg>
            </span>

            <span
                v-if="cashState === 'accepting'"
                class="cash-device-timer"
                aria-label="Оставшееся время на внесение купюры"
            >
                <strong>{{ acceptanceTimeLabel }}</strong>
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
                v-else-if="cashState === 'fiscalizing'"
                class="cash-device-content"
            >
                <strong>Передаём продажу в Vendotek</strong>
                <span>Не закрывайте экран и не начинайте новую оплату</span>
            </span>

            <span
                v-else-if="isPartialPayment"
                class="cash-device-content"
            >
                <strong>Приём купюр приостановлен</strong>
                <span>Выберите, как поступить с уже внесённой суммой</span>
            </span>

            <span
                v-else-if="cashState === 'balance_credit_required'"
                class="cash-device-content"
            >
                <strong>Зачисляем внесённую сумму</strong>
                <span>Дождитесь экрана с QR-кодом заказа</span>
            </span>

            <span
                v-else-if="cashState === 'balance_credit_ready'"
                class="cash-device-content"
            >
                <strong>Сумма подготовлена к зачислению</strong>
                <span>Отсканируйте QR-код, затем можно начать новый заказ</span>
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
            v-if="[
                'accepting',
                'fiscalizing',
                'partial_payment',
                'balance_credit_required',
                'balance_credit_ready',
                'attention_required',
            ].includes(cashState)"
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
            <!--
            <div v-if="acceptedBills.length" class="cash-bills-summary">
                Принято купюр: {{ acceptedBills.length }} · Последняя:
                {{ formatMoney(acceptedBills.at(-1)?.amountMinor) }}
            </div>
            -->
        </div>

        <div
            v-if="isPartialPayment"
            class="cash-partial-payment mt-6"
        >
            <div class="cash-partial-timer">
                <span>Время на выбор</span>
                <strong>{{ decisionTimeLabel }}</strong>
            </div>
            <p>
                Если не выбрать действие, внесённая сумма будет утеряна!
            </p>
            <div class="cash-partial-actions">
                <button
                    type="button"
                    class="__button --green"
                    :disabled="isResuming"
                    @click="resumePartialPayment"
                >
                    {{ isResuming ? 'Возобновляем…' : 'Продолжить оплату' }}
                </button>
                <call-support-component />
                <button
                    type="button"
                    class="__button"
                    :disabled="isResuming || isCreditingBalance"
                    @click="creditPartialBalance(session, { force: true })"
                >
                    {{
                        isCreditingBalance
                            ? 'Зачисляем сумму…'
                            : 'Зачислить на баланс'
                    }}
                </button>
            </div>
        </div>

        <div
            v-if="cashState === 'balance_credit_required'"
            class="cash-balance-credit mt-6"
        >
            <p>Подтверждаем зачисление {{ formatMoney(acceptedAmountMinor) }} на баланс…</p>
            <button
                v-if="balanceCreditError"
                type="button"
                class="__button"
                :disabled="isCreditingBalance"
                @click="creditPartialBalance(session, { force: true })"
            >
                Повторить зачисление
            </button>
            <call-support-component v-if="balanceCreditError" />
        </div>

        <div
            v-if="billSyncError"
            class="cash-sync-warning mt-4"
        >
            {{ billSyncError }}
        </div>

        <div
            v-if="balanceCreditError"
            class="payment-cancel-error mt-4"
            aria-live="assertive"
        >
            {{ balanceCreditError }}
        </div>

        <div
            v-if="connectionState === 'reconnecting' && cashState === 'accepting'"
            class="cash-connection mt-4"
        >
            Восстанавливаем связь с купюроприёмником…
        </div>

        <div
            v-if="isMockMode && cashState === 'accepting'"
            class="cash-test-panel mt-6"
        >
            <strong>Тестовый режим оплаты наличными</strong>
            <span>Добавьте виртуальную купюру</span>
            <div class="cash-test-actions">
                <button
                    v-for="amountRub in mockAmountsRub"
                    :key="amountRub"
                    type="button"
                    class="__button"
                    :disabled="isMockInserting"
                    @click="insertMockBill(amountRub * 100)"
                >
                    {{ amountRub }} ₽
                </button>
                <button
                    v-if="remainingAmountMinor > 0"
                    type="button"
                    class="__button --green"
                    :disabled="isMockInserting"
                    @click="insertMockBill(remainingAmountMinor)"
                >
                    Внести остаток
                </button>
            </div>
            <div v-if="mockError" class="cash-test-error">
                {{ mockError }}
            </div>
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
    justify-content: flex-start;
    gap: 0.75rem;
    padding: 0.85rem;
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
    min-width: 0;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.75rem;
    font-weight: 500;
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
    font-size: 0.8rem;
    font-weight: 700;
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
    font-size: 0.75rem;
    font-weight: 600;
}

.cash-bills-summary {
    color: rgba(34, 64, 98, 0.78);
}

.cash-no-change {
    color: #e8541e;
}

.cash-test-panel {
    display: grid;
    gap: 0.65rem;
    padding: 1rem;
    border: 0.12rem dashed var(--green-color);
    border-radius: 0.85rem;
    background: #f3fff4;
    text-align: center;
    font-size: 0.7rem;
}

.cash-test-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
}

.cash-test-actions .__button {
    min-width: 4.5rem;
}

.cash-test-error {
    color: #b63d12;
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

.cash-partial-payment,
.cash-balance-credit {
    padding: 1rem;
    border-radius: 0.85rem;
    background: #ffffff;
    box-shadow: 0 0.25rem 0.5rem 0 rgba(0, 0, 0, 0.18);
    text-align: center;
}

.cash-partial-payment p,
.cash-balance-credit p {
    margin: 0.75rem 0 0;
    font-size: 0.65rem;
    font-weight: 500;
}

.cash-device-timer {
    display: flex;
    flex: 0 0 auto;
    order: 3;
    min-width: 3.3rem;
    box-sizing: border-box;
    align-items: center;
    justify-content: center;
    align-self: center;
    margin-left: auto;
    padding: 0.35rem 0.45rem;
    border: 0.08rem solid rgba(34, 64, 98, 0.28);
    border-radius: 0.55rem;
    background: #f7fbff;
}

.cash-device-timer strong {
    font-family: monospace;
    font-size: 1rem;
    line-height: 1;
}

.cash-partial-timer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
}

.cash-partial-timer strong {
    display: flex;
    min-width: 3.3rem;
    box-sizing: border-box;
    align-items: center;
    justify-content: center;
    padding: 0.35rem 0.45rem;
    border: 0.08rem solid rgba(34, 64, 98, 0.28);
    border-radius: 0.55rem;
    background: #f7fbff;
    font-family: monospace;
    font-size: 1.25rem;
    line-height: 1;
}

.cash-partial-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
    margin-top: 1rem;
}

.cash-partial-actions .__button,
.cash-balance-credit .__button {
    width: 100%;
}

.cash-sync-warning {
    color: #9e6711;
    font-size: 0.6rem;
    font-weight: 600;
    text-align: center;
}
</style>
