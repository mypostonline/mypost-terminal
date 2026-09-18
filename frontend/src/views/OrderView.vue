<script setup>
import {
    computed,
    onBeforeMount,
    onBeforeUnmount,
    ref,
    watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useOrderStore } from "@/stores/orderStore.js";
import { usePaymentStore } from "@/stores/paymentStore.js";
import { getPaymentMethodCode } from "@/config/paymentMethods.js";
import { getOrderUrl } from "@/functions/orderUrl.js";
import { calculateCashbackAmount } from "@/functions/cashback.js";
import {
    CLOSED_ORDER_STATUSES,
    PAID_ORDER_STATUSES,
    PAYABLE_ORDER_STATUSES,
    getOrderStatus,
} from "@/config/orderStatuses.js";
import CallSupportComponent from "@/components/CallSupportComponent.vue";
import FixedActions from "@/components/FixedActions.vue";
import OrderQrCode from "@/components/order/OrderQrCode.vue";
import CardPaymentScenario from "@/components/payment/CardPaymentScenario.vue";
import CashPaymentScenario from "@/components/payment/CashPaymentScenario.vue";
import SbpPaymentScenario from "@/components/payment/SbpPaymentScenario.vue";

const route = useRoute();
const router = useRouter();

const orderStore = useOrderStore();
const { order } = storeToRefs(orderStore);

const paymentStore = usePaymentStore();
const {
    phase: storedPaymentPhase,
    paidAmount: storedPaidAmount,
    orderSnapshot,
} = storeToRefs(paymentStore);

const isInitialized = ref(false);
const paymentState = ref('loading');
const paymentError = ref('');
const balanceCreditAmount = ref(0);
const paymentControls = ref(null);
const resumeExistingDeviceSession = ref(
    paymentStore.matchesOrder(route.params.orderId) &&
    [ 'processing', 'attention_required' ].includes(
        storedPaymentPhase.value
    )
);

let reconciliationTimer = null;
let resultTimer = null;
const configuredResultSeconds = Number(import.meta.env.VITE_ORDER_RESULT_TIMEOUT_SECONDS);
const resultTimeoutMs = (
    Number.isFinite(configuredResultSeconds) && configuredResultSeconds > 0 && configuredResultSeconds <= 2147483
        ? configuredResultSeconds
        : 120
) * 1000;
let reconciliationAttempts = 0;
let reconciliationInProgress = false;

const paymentScenarios = {
    sbp: SbpPaymentScenario,
    card: CardPaymentScenario,
    cash: CashPaymentScenario,
};

const paymentMethodCode = computed(() => {
    return getPaymentMethodCode(order.value?.payment_method);
});

const paymentScenario = computed(() => {
    return paymentScenarios[paymentMethodCode.value];
});

const orderQrUrl = computed(() => getOrderUrl(order.value?.uuid));
const changeAmount = computed(() => {
    const changeAmount = Number(order.value?.change_amount);

    return Number.isFinite(changeAmount) && changeAmount > 0
        ? changeAmount
        : 0;
});
const cashbackAmount = computed(() => {
    const cashbackAmount = Number(order.value?.cashback_amount);

    if (Number.isFinite(cashbackAmount) && cashbackAmount > 0) {
        return cashbackAmount;
    }
    return calculateCashbackAmount(
        order.value?.total_amount,
        order.value?.cashback_percent
    );
});
const showOrderQr = computed(() => (
    [
        'reconciling',
        'attention',
        'cash_session_completed',
        'paid',
        'unsupported',
        'closed',
    ].includes(paymentState.value) && Boolean(orderQrUrl.value)
));
const canRetryPayment = computed(() => {
    return [ 'failed', 'unsupported', 'closed' ].includes(
        paymentState.value
    );
});
const paymentActions = computed(() => (
    paymentState.value === 'processing'
        ? paymentControls.value?.actions || []
        : []
));
const inlineActionIds = new Set(['resume', 'credit-balance']);
const inlinePaymentActions = computed(() => paymentActions.value.filter(action => inlineActionIds.has(action.id)));
const panelPaymentActions = computed(() => paymentActions.value.filter(action => !inlineActionIds.has(action.id)));
const canReturnHome = computed(() => (
    canRetryPayment.value ||
    [ 'cash_session_completed', 'paid' ].includes(paymentState.value)
));

const clearFinishedPayment = () => {
    if ([ 'cash_session_completed', 'paid' ].includes(paymentState.value)) {
        paymentStore.clear();
    }
};

watch([paymentState, isInitialized], ([state, initialized]) => {
    window.clearTimeout(resultTimer);
    resultTimer = null;
    if (!initialized || !['paid', 'cash_session_completed'].includes(state)) return;
    resultTimer = window.setTimeout(() => {
        clearFinishedPayment();
        router.replace({ name: 'home' });
    }, resultTimeoutMs);
});

const failureTitle = computed(() => {
    if (paymentState.value === 'unsupported') {
        return 'Способ оплаты недоступен';
    }
    if (paymentState.value === 'closed') {
        return 'Заказ уже закрыт';
    }
    return 'Оплата не принята';
});

const setPaymentFailed = message => {
    paymentError.value =
        message ||
        'Повторите попытку или выберите другой способ оплаты';
    paymentState.value = 'failed';
    paymentStore.markFailed(paymentError.value);
};

const handlePaymentAttention = message => {
    paymentError.value =
        message ||
        'Результат оплаты требует проверки. Не повторяйте платёж';
    paymentState.value = 'attention';
    paymentStore.markAttentionRequired(paymentError.value);
};

const handlePaymentCanceled = async () => {
    paymentStore.clear();
    orderStore.clearOrder();
    await router.replace({ name: 'home' });
};

const scheduleReconciliation = () => {
    if (reconciliationTimer) {
        return;
    }

    const retryDelay = Math.min(
        5_000 * (2 ** reconciliationAttempts),
        60_000
    );
    reconciliationAttempts += 1;
    reconciliationTimer = window.setTimeout(() => {
        reconciliationTimer = null;
        synchronizePaidOrder();
    }, retryDelay);
};

const synchronizePaidOrder = async () => {
    if (
        reconciliationInProgress ||
        !order.value?.id ||
        !Number.isFinite(Number(storedPaidAmount.value)) ||
        Number(storedPaidAmount.value) <= 0
    ) {
        return;
    }

    reconciliationInProgress = true;
    paymentState.value = 'reconciling';

    try {
        const paidOrderId = order.value.id;
        await orderStore.paidOrder(
            paidOrderId,
            Number(storedPaidAmount.value)
        );
        const refreshedOrder = await orderStore.refreshOrder(paidOrderId);
        if (!refreshedOrder?.id) {
            throw new Error('Не удалось обновить оплаченный заказ');
        }
        reconciliationAttempts = 0;
        paymentError.value = '';
        paymentState.value = 'paid';
        paymentStore.markCompleted();
    }
    catch (error) {
        console.error('Failed to mark order as paid', error);
        paymentError.value =
            'Оплата получена. Подтверждаем заказ — не оплачивайте повторно';
        paymentStore.markReconciliationRequired(paymentError.value);
        scheduleReconciliation();
    }
    finally {
        reconciliationInProgress = false;
    }
};

const handlePaymentApproved = async paidAmount => {
    if (paymentState.value !== 'processing') {
        return;
    }

    const normalizedPaidAmount = Number(paidAmount);
    const expectedAmount = Number(order.value.total_amount);
    paymentStore.markApproved(normalizedPaidAmount);

    const amountIsValid = Number.isFinite(normalizedPaidAmount) &&
        Number.isFinite(expectedAmount) &&
        (
            paymentMethodCode.value === 'cash'
                ? normalizedPaidAmount >= expectedAmount
                : Math.abs(normalizedPaidAmount - expectedAmount) < 0.001
        );

    if (!amountIsValid) {
        handlePaymentAttention(
            'Принятая сумма отличается от суммы заказа. Вызовите оператора'
        );
        return;
    }

    paymentState.value = 'reconciling';
    await synchronizePaidOrder();
};

const handleBalanceCreditReady = amount => {
    balanceCreditAmount.value = Number.isFinite(Number(amount)) && Number(amount) > 0 ? Number(amount) : 0;
    paymentStore.markCompleted();
    paymentError.value = '';
    paymentState.value = 'cash_session_completed';
};

const handleServerPaid = paidOrder => {
    if (paymentMethodCode.value !== 'sbp' || String(paidOrder?.id) !== String(order.value.id) ||
        !PAID_ORDER_STATUSES.has(getOrderStatus(paidOrder))) return;
    orderStore.setOrder(paidOrder);
    paymentStore.markCompleted();
    paymentError.value = '';
    paymentState.value = 'paid';
};

const continueRecoverablePayment = async () => {
    if (!paymentStore.isRecoverableOrder(route.params.orderId)) {
        return false;
    }

    if (!order.value?.id && orderSnapshot.value?.id) {
        orderStore.setOrder(orderSnapshot.value);
    }

    if (!order.value?.id) {
        return false;
    }

    if (
        storedPaymentPhase.value === 'reconciling' &&
        Number(storedPaidAmount.value) > 0
    ) {
        paymentState.value = 'reconciling';
        await synchronizePaidOrder();
        return true;
    }

    if (!paymentScenario.value) {
        paymentState.value = 'unsupported';
        paymentError.value = 'Выбранный способ оплаты не поддерживается';
        paymentStore.markFailed(paymentError.value);
        return true;
    }

    if (storedPaymentPhase.value !== 'attention_required') {
        paymentStore.markProcessing(order.value);
    }
    paymentState.value = 'processing';
    return true;
};

onBeforeMount(async () => {
    try {
        const loadedOrder = await orderStore.getOrder(route.params.orderId);

        if (!loadedOrder?.id) {
            paymentError.value = 'Заказ не найден';
            paymentState.value = 'failed';
            paymentStore.markFailed(paymentError.value);
            return;
        }

        const orderStatus = getOrderStatus(loadedOrder);

        if (PAID_ORDER_STATUSES.has(orderStatus)) {
            paymentState.value = 'paid';
            paymentStore.markCompleted();
            return;
        }

        if (
            paymentStore.matchesOrder(loadedOrder.id) &&
            storedPaymentPhase.value === 'reconciling' &&
            Number(storedPaidAmount.value) > 0
        ) {
            paymentState.value = 'reconciling';
            await synchronizePaidOrder();
            return;
        }

        const hasActiveDevicePayment =
            paymentStore.matchesOrder(loadedOrder.id) &&
            [ 'processing', 'attention_required' ].includes(
                storedPaymentPhase.value
            );

        if (CLOSED_ORDER_STATUSES.has(orderStatus)) {
            if (hasActiveDevicePayment) {
                paymentState.value = 'processing';
                return;
            }
            paymentState.value = 'closed';
            paymentError.value = 'Этот заказ нельзя оплачивать';
            paymentStore.markFailed(paymentError.value);
            return;
        }

        const isRecoverableOrderWithoutStatus =
            !orderStatus &&
            paymentStore.matchesOrder(loadedOrder.id) &&
            [ 'prepared', 'processing', 'attention_required' ].includes(
                storedPaymentPhase.value
            );

        if (
            !PAYABLE_ORDER_STATUSES.has(orderStatus) &&
            !isRecoverableOrderWithoutStatus
        ) {
            paymentState.value = 'closed';
            paymentError.value =
                'Статус заказа не разрешает начинать оплату';
            paymentStore.markFailed(paymentError.value);
            return;
        }

        if (!paymentScenario.value) {
            paymentError.value =
                'Выбранный способ оплаты не поддерживается';
            paymentState.value = 'unsupported';
            paymentStore.markFailed(paymentError.value);
            return;
        }

        if (
            paymentStore.matchesOrder(loadedOrder.id) &&
            storedPaymentPhase.value === 'attention_required'
        ) {
            paymentState.value = 'processing';
            return;
        }

        paymentStore.markProcessing(loadedOrder);
        paymentState.value = 'processing';
    }
    catch (error) {
        console.error('Failed to load order', error);

        const recovered = await continueRecoverablePayment();
        if (!recovered) {
            paymentError.value = 'Не удалось загрузить заказ';
            paymentState.value = 'failed';
            paymentStore.markFailed(paymentError.value);
        }
    }
    finally {
        isInitialized.value = true;
    }
});

onBeforeUnmount(() => {
    window.clearTimeout(resultTimer);
    if (reconciliationTimer) {
        window.clearTimeout(reconciliationTimer);
    }
});
</script>

<template>
    <main v-if="isInitialized && order.id" class="order-view">
        <component
            v-if="paymentState === 'processing' && paymentScenario"
            :is="paymentScenario"
            ref="paymentControls"
            :order="order"
            :resume-only="resumeExistingDeviceSession"
            @approved="handlePaymentApproved"
            @server-paid="handleServerPaid"
            @balance-credit-ready="handleBalanceCreditReady"
            @failed="setPaymentFailed"
            @attention="handlePaymentAttention"
            @canceled="handlePaymentCanceled"
        />

        <template v-else-if="paymentState === 'reconciling'">
            <div class="text-center payment-reconciliation" aria-live="polite">
                <svg class="__svg payment-result-icon">
                    <use xlink:href="#clock-waiting"></use>
                </svg>
                <h2 class="mt-4">Оплата получена</h2>
                <h3 class="mt-4">
                    Подтверждаем заказ.<br>
                    Не оплачивайте его повторно
                </h3>
                <div v-if="paymentError" class="payment-error mt-4">
                    {{ paymentError }}
                </div>
            </div>
        </template>

        <template v-else-if="paymentState === 'attention'">
            <div class="text-center payment-attention" aria-live="assertive">
                <svg class="__svg payment-result-icon --error">
                    <use xlink:href="#clock-error"></use>
                </svg>
                <h2 class="mt-4">Требуется помощь оператора</h2>
                <h3 class="mt-4">
                    Не начинайте новую оплату
                </h3>
                <div class="payment-error mt-4">{{ paymentError }}</div>
            </div>
        </template>

        <template v-else-if="paymentState === 'cash_session_completed'">
            <div class="text-center">
                <svg class="__svg payment-result-icon">
                    <use xlink:href="#clock-ok"></use>
                </svg>
                <h2 class="mt-4">Заказ отменён</h2>
            </div>
            <order-qr-code
                v-if="showOrderQr"
                :order-id="order.id"
                :order-url="orderQrUrl"
                :balance-credit-amount="balanceCreditAmount"
            />
        </template>

        <template v-else-if="paymentState === 'paid'">
            <div class="text-center">
                <svg class="__svg payment-result-icon">
                    <use xlink:href="#clock-ok"></use>
                </svg>
                <h2 class="mt-4">Оплата принята</h2>
                <h3 class="mt-4">
                    Благодарим Вас за использование<br>
                    нашего сервиса
                </h3>
            </div>
            <order-qr-code
                v-if="showOrderQr"
                :order-id="order.id"
                :order-url="orderQrUrl"
                :change-amount="changeAmount"
                :cashback-amount="cashbackAmount"
            />
        </template>

        <template v-else>
            <div class="text-center">
                <svg class="__svg payment-result-icon --error">
                    <use xlink:href="#clock-error"></use>
                </svg>
                <h2 class="mt-4">{{ failureTitle }}</h2>
            </div>

            <div class="post-info mt-24">
                <div class="post-status" style="max-width: 14rem;">
                    <svg class="__svg shape" style="fill: #E8541E;">
                        <use xlink:href="#shape"></use>
                    </svg>
                    <svg class="__svg face">
                        <use xlink:href="#frowny-face"></use>
                    </svg>
                </div>
            </div>
            <div v-if="paymentError" class="text-center">
                <div class="payment-error mt-4">{{ paymentError }}</div>
            </div>

            <order-qr-code
                v-if="showOrderQr"
                :order-id="order.id"
                :order-url="orderQrUrl"
            />

        </template>

        <order-qr-code
            v-if="
                showOrderQr &&
                !canRetryPayment &&
                ![ 'cash_session_completed', 'paid' ].includes(paymentState)
            "
            :order-id="order.id"
            :order-url="orderQrUrl"
        />

        <div v-if="inlinePaymentActions.length" class="order-payment-actions" role="group" aria-label="Действия с внесённой суммой">
            <button
                v-for="action in inlinePaymentActions"
                :key="action.id"
                type="button"
                class="__button --tile"
                :disabled="action.disabled"
                @click="action.run()"
            >
                <span class="__button-icon">
                    <svg class="__svg" aria-hidden="true"><use :xlink:href="`#${action.icon}`" /></svg>
                </span>
                <span>{{ action.label }}</span>
            </button>
        </div>
    </main>

    <main v-else-if="isInitialized" class="order-view text-center">
        <svg class="__svg payment-result-icon --error">
            <use xlink:href="#clock-error"></use>
        </svg>
        <h2 class="mt-4">Не удалось открыть заказ</h2>
        <div class="payment-error mt-4">{{ paymentError }}</div>
    </main>

    <fixed-actions v-if="isInitialized" label="Действия с заказом">
        <router-link
            v-if="canReturnHome"
            to="/"
            class="__button --green"
            @click="clearFinishedPayment"
        >
            <svg class="__svg" aria-hidden="true"><use xlink:href="#home" /></svg>
            На главную
        </router-link>
        <button
            v-for="action in panelPaymentActions"
            :key="action.id"
            type="button"
            class="__button"
            :class="{ '--green': action.primary, '--white': action.id === 'cancel' }"
            :disabled="action.disabled"
            @click="action.run()"
        >
            <svg v-if="action.icon" class="__svg" aria-hidden="true">
                <use :xlink:href="`#${action.icon}`" />
            </svg>
            <span>{{ action.label }}</span>
        </button>
        <template #trailing>
            <call-support-component :show-text="false" />
        </template>
    </fixed-actions>
</template>

<style scoped>
.order-payment-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    margin-top: 1rem;
}

.order-view {
    min-width: 0;
    overflow-wrap: anywhere;
}

.payment-result-icon {
    width: 4rem;
    height: 4rem;
    color: var(--green-color);
}

.payment-result-icon.--error {
    color: #e8541e;
}

.payment-reconciliation {
    padding: 1rem;
    border-radius: 0.85rem;
    background: #fff8e8;
}

.payment-attention {
    padding: 1rem;
    border-radius: 0.85rem;
    background: #fff5f1;
}

.payment-error {
    font-size: 1.333rem;
    font-weight: 600;
    line-height: 1.2em;
}

</style>
