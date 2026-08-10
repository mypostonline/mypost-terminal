<script setup>
import {
    computed,
    onBeforeMount,
    onBeforeUnmount,
    ref,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useOrderStore } from "@/stores/orderStore.js";
import { usePaymentStore } from "@/stores/paymentStore.js";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { getPaymentMethodCode } from "@/config/paymentMethods.js";
import {
    CLOSED_ORDER_STATUSES,
    PAID_ORDER_STATUSES,
    PAYABLE_ORDER_STATUSES,
    getOrderStatus,
} from "@/config/orderStatuses.js";
import CallSupportComponent from "@/components/CallSupportComponent.vue";
import OfferLinkComponent from "@/components/OfferLinkComponent.vue";
import CardPaymentScenario from "@/components/payment/CardPaymentScenario.vue";
import CashPaymentScenario from "@/components/payment/CashPaymentScenario.vue";
import CashChangeCreditQr from "@/components/payment/CashChangeCreditQr.vue";

const route = useRoute();
const router = useRouter();

const propertyStore = usePropertyStore();
const { property } = storeToRefs(propertyStore);

const orderStore = useOrderStore();
const { order } = storeToRefs(orderStore);

const paymentStore = usePaymentStore();
const {
    phase: storedPaymentPhase,
    paidAmount: storedPaidAmount,
    orderSnapshot,
    changeCredit,
} = storeToRefs(paymentStore);

const isInitialized = ref(false);
const paymentState = ref('loading');
const paymentError = ref('');
const resumeExistingDeviceSession = ref(
    paymentStore.matchesOrder(route.params.orderId) &&
    [ 'processing', 'attention_required' ].includes(
        storedPaymentPhase.value
    )
);

let reconciliationTimer = null;
let reconciliationAttempts = 0;
let reconciliationInProgress = false;

const paymentScenarios = {
    card: CardPaymentScenario,
    cash: CashPaymentScenario,
};

const paymentMethodCode = computed(() => {
    return getPaymentMethodCode(order.value?.payment_method);
});

const paymentScenario = computed(() => {
    return paymentScenarios[paymentMethodCode.value];
});

const isCardPayment = computed(() => paymentMethodCode.value === 'card');
const isCashPayment = computed(() => paymentMethodCode.value === 'cash');
const canRetryPayment = computed(() => {
    return [ 'failed', 'unsupported', 'closed' ].includes(
        paymentState.value
    );
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
        await orderStore.paidOrder(
            order.value.id,
            Number(storedPaidAmount.value)
        );
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

const handleChangeCredit = claim => {
    paymentStore.setChangeCredit(claim);
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
    if (reconciliationTimer) {
        window.clearTimeout(reconciliationTimer);
    }
});
</script>

<template>
    <main v-if="isInitialized && order.id">
        <component
            v-if="paymentState === 'processing' && paymentScenario"
            :is="paymentScenario"
            :order="order"
            :resume-only="resumeExistingDeviceSession"
            @approved="handlePaymentApproved"
            @change-credit="handleChangeCredit"
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
            <cash-change-credit-qr
                v-if="isCashPayment && changeCredit?.amountMinor > 0"
                :change-credit="changeCredit"
            />
            <div class="mt-16 text-center">
                <router-link
                    to="/"
                    class="__button --green"
                    @click="paymentStore.clear"
                >
                    На главную
                </router-link>
            </div>
        </template>

        <template v-else>
            <div class="text-center">
                <svg class="__svg payment-result-icon --error">
                    <use xlink:href="#clock-error"></use>
                </svg>
                <h2 class="mt-4">{{ failureTitle }}</h2>
                <div class="payment-error mt-4">{{ paymentError }}</div>
            </div>

            <div class="post-info mt-16">
                <div class="post-status" style="max-width: 10rem;">
                    <svg class="__svg shape" style="fill: #E8541E;">
                        <use xlink:href="#shape"></use>
                    </svg>
                    <svg class="__svg face">
                        <use xlink:href="#frowny-face"></use>
                    </svg>
                </div>
            </div>

            <div
                class="payment-result-actions mt-16"
                :class="{ '--single': !canRetryPayment }"
            >
                <router-link to="/" class="__button --green">
                    На главную
                </router-link>
                <router-link
                    v-if="canRetryPayment"
                    :to="`/programs/${order.program_id}`"
                    class="__button"
                >
                    Выбрать оплату заново
                </router-link>
            </div>
        </template>

        <div class="mt-6 text-center">
            <call-support-component />
        </div>
        <div class="mt-4 text-center">
            <input type="checkbox" checked disabled>
            Заплатив здесь, вы принимаете условия сервиса<template
                v-if="isCardPayment"
            >, платёжного агрегатора</template><template
                v-if="property?.proprietor?.public_offer_url"
            > и <offer-link-component
                :url="property.proprietor.public_offer_url"
            /></template>.
        </div>
    </main>

    <main v-else-if="isInitialized" class="text-center">
        <svg class="__svg payment-result-icon --error">
            <use xlink:href="#clock-error"></use>
        </svg>
        <h2 class="mt-4">Не удалось открыть заказ</h2>
        <div class="payment-error mt-4">{{ paymentError }}</div>
        <div class="mt-16">
            <router-link to="/" class="__button --green">
                На главную
            </router-link>
        </div>
    </main>
</template>

<style scoped>
.payment-result-icon {
    width: 4rem;
    height: 4rem;
    fill: var(--green-color);
}

.payment-result-icon.--error {
    fill: #e8541e;
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
    font-size: 0.75rem;
    font-weight: 500;
}

.payment-result-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: center;
    gap: 1rem;
}

.payment-result-actions.--single {
    grid-template-columns: minmax(0, 1fr);
}
</style>
