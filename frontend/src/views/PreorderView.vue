<script setup>
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { useOrderStore } from "@/stores/orderStore.js";
import { usePaymentStore } from "@/stores/paymentStore.js";
import { usePaymentCapabilitiesStore } from "@/stores/paymentCapabilitiesStore.js";
import { getPrice } from "@/functions/helpers.js";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import CallSupportComponent from "@/components/CallSupportComponent.vue";
import OfferLinkComponent from "@/components/OfferLinkComponent.vue";
import { getConfiguredPaymentMethods } from "@/config/paymentMethods.js";
import { isPostAcceptingOrders } from "@/config/postAvailability.js";

const router = useRouter();

const propertyStore = usePropertyStore();
const { property, post, program, order } = storeToRefs(propertyStore);

const orderStore = useOrderStore();
const paymentStore = usePaymentStore();
const paymentCapabilitiesStore = usePaymentCapabilitiesStore();
const {
    methods: runtimePaymentMethods,
    isLoading: isCheckingPayments,
} = storeToRefs(paymentCapabilitiesStore);

const isCreatingOrder = ref(false);
const selectedPaymentMethod = ref(null);
const createError = ref('');
let capabilitiesTimer = null;

const paymentMethods = computed(() => getConfiguredPaymentMethods(
    post.value,
    runtimePaymentMethods.value
).map(method => {
    if (isPostAcceptingOrders(post.value)) {
        return method;
    }
    return {
        ...method,
        available: false,
        unavailableLabel: 'Пост временно недоступен',
    };
}));

const DRAFT_REQUEST_KEY = 'mypost.orderDraftRequest';

const getOrderRequestId = (data) => {
    const fingerprint = JSON.stringify(data);

    try {
        const saved = JSON.parse(
            sessionStorage.getItem(DRAFT_REQUEST_KEY) || 'null'
        );
        if (saved?.fingerprint === fingerprint && saved?.requestId) {
            return saved.requestId;
        }
    }
    catch {
        sessionStorage.removeItem(DRAFT_REQUEST_KEY);
    }

    const requestId = globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(DRAFT_REQUEST_KEY, JSON.stringify({
        fingerprint,
        requestId,
    }));
    return requestId;
};

const createOrder = async (paymentMethod) => {
    if (isCreatingOrder.value || !paymentMethod.available) {
        return;
    }

    isCreatingOrder.value = true;
    selectedPaymentMethod.value = paymentMethod.code;
    createError.value = '';

    try {
        await paymentCapabilitiesStore.refresh();
        const currentPaymentMethod = paymentMethods.value.find(
            item => item.code === paymentMethod.code
        );

        if (!currentPaymentMethod?.available) {
            createError.value =
                currentPaymentMethod?.unavailableLabel ||
                'Выбранный способ оплаты сейчас недоступен';
            return;
        }

        const orderData = {
            ...order.value,
            payment_method: currentPaymentMethod.paymentMethod,
        };
        if (
            !orderData.property_id ||
            !orderData.post_id ||
            !orderData.program_id ||
            Number(orderData.total_amount) <= 0
        ) {
            throw new Error('Данные заказа устарели. Вернитесь к выбору программы');
        }
        const requestId = getOrderRequestId(orderData);
        const createdOrder = await orderStore.createOrder(
            orderData,
            { requestId }
        );

        if (!createdOrder?.id) {
            throw new Error('Сервер не вернул номер заказа');
        }

        sessionStorage.removeItem(DRAFT_REQUEST_KEY);
        paymentStore.prepare(createdOrder);
        await router.replace({ path: '/order/' + createdOrder.id });
    }
    catch (error) {
        console.error('Failed to create order', error);
        paymentStore.clear();
        createError.value =
            error.message ||
            'Не удалось создать заказ. Проверьте соединение и повторите';
    }
    finally {
        isCreatingOrder.value = false;
        selectedPaymentMethod.value = null;
    }
}

const countAddons = computed(() => property.value.addons?.filter(item => item.isActive).length);

onMounted(() => {
    paymentCapabilitiesStore.refresh();
    capabilitiesTimer = window.setInterval(
        () => paymentCapabilitiesStore.refresh(),
        5_000
    );
});

onBeforeUnmount(() => {
    if (capabilitiesTimer) {
        window.clearInterval(capabilitiesTimer);
    }
});

</script>

<template>

    <main>
        <div class="text-center">
            <svg class="__svg" style="fill: var(--green-color); width: 4rem; height: 4rem;">
                <use xlink:href="#clock-waiting"></use>
            </svg>
            <h2 class="mt-4">В заказе</h2>
        </div>
        <div class="order-final-list mt-6">
            <div class="header">
                <div class="title">Итоговый список</div>
            </div>
            <div class="content">
                <div class="label">Режим:</div>
                <div class="item">
                    <span>{{ program.name }}</span>
                    <span>{{ getPrice(program.price) }}</span>
                </div>
                <template v-if="countAddons > 0">
                    <div class="label">Дополнительные услуги:</div>
                    <template
                        v-for="addon in property.addons"
                        :key="addon.id"
                    >
                        <div v-if="addon.isActive" class="item">
                            <span>{{ addon.name }}</span>
                            <span v-if="!addon.isComposite && !addon.isIncluded">{{ getPrice(addon.price) }}</span>
                        </div>
                    </template>
                </template>
                <div class="item label" style="color: var(--green-color);">
                    <span>Итого:</span>
                    <span>{{ getPrice(order.total_amount) }}</span>
                </div>
            </div>
            <div v-if="order.cashback_percent > 0" class="footer">
                <div class="item">
                    <span>Начислено бонусов*</span>
                    <span>{{ getPrice(order.cashback_amount) }}</span>
                </div>
            </div>
        </div>
        <div
            v-if="order.cashback_percent > 0"
            style="font-size: 0.75rem; font-weight: 500; margin-top: 1rem;"
        >
            *Для зачисления бонусов, сканируй QR-код после оплаты заказа
        </div>
        <section class="payment-choice mt-6">
            <h2 class="payment-choice-title">Выберите способ оплаты</h2>
            <div
                v-if="paymentMethods.length"
                class="payment-methods"
                :class="{ '--single': paymentMethods.length === 1 }"
            >
                <button
                    v-for="paymentMethod in paymentMethods"
                    :key="paymentMethod.code"
                    class="payment-method-button"
                    :class="`--${paymentMethod.code}`"
                    type="button"
                    :disabled="
                        isCreatingOrder ||
                        isCheckingPayments ||
                        !paymentMethod.available
                    "
                    @click="createOrder(paymentMethod)"
                >
                    <span class="payment-method-icon">
                        <svg class="__svg">
                            <use :xlink:href="`#${paymentMethod.icon}`"></use>
                        </svg>
                    </span>
                    <span class="payment-method-content">
                        <span class="payment-method-title">
                            {{
                                selectedPaymentMethod === paymentMethod.code
                                    ? 'Создаём заказ…'
                                    : paymentMethod.actionLabel
                            }}
                        </span>
                        <span class="payment-method-description">
                            {{
                                paymentMethod.available
                                    ? paymentMethod.description
                                    : paymentMethod.unavailableLabel || 'Временно недоступно'
                            }}
                        </span>
                        <span class="payment-method-amount">{{ getPrice(order.total_amount) }}</span>
                    </span>
                </button>
            </div>
            <div v-else class="payment-methods-empty">
                Оплата на этом терминале временно недоступна
            </div>
            <div
                v-if="createError"
                class="payment-error mt-4"
                role="alert"
            >
                {{ createError }}
            </div>
        </section>

        <!--<div class="preorder-navigation"></div>-->
        <div class="mt-6" style="display: grid; grid-template-columns: 1fr 2fr 1fr; align-items: center;">
            <div>
                <router-link
                    :to="`/programs/${program.id}`"
                    class="__button --small"
                >
                    <svg class="__svg" style="fill: var(--primary-color); transform: rotate(180deg);">
                        <use xlink:href="#arrow"></use>
                    </svg>
                </router-link>
            </div>
            <div></div>
            <div class="flex justify-end">
                <call-support-component :show-text="false" />
            </div>
        </div>

        <!--
        <div class="mt-6 text-center">
            <call-support-component />
        </div>
        -->

        <div class="mt-4 text-center" style="font-size: 0.75rem; font-weight: 500; margin-top: 1rem;">
            <input type="checkbox" checked disabled>
            Выбирая оплату, вы принимаете условия сервиса
            <template
                v-if="property?.proprietor?.public_offer_url"
            > и
                <offer-link-component
                    :url="property.proprietor.public_offer_url"
                />
            </template>
            . При оплате картой также действуют условия
            платёжного агрегатора.
        </div>
    </main>

</template>

<style scoped>

.payment-choice-title {
    margin-bottom: 0.75rem;
    text-align: center;
}

.payment-methods {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
}

.payment-methods.--single {
    grid-template-columns: minmax(0, 18rem);
    justify-content: center;
}

.payment-method-button {
    display: grid;
    grid-template-columns: 3.25rem minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 6.5rem;
    padding: 0.75rem;
    border-radius: 0.85rem;
    color: var(--primary-color);
    background: #ffffff;
    box-shadow: 0 0.25rem 0.5rem rgba(0, 0, 0, 0.18);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.2s ease-out,
    box-shadow 0.2s ease-out,
    transform 0.1s ease-out;
}

.payment-method-button:focus-visible {
    border-color: var(--green-color);
    box-shadow: 0 0.3rem 0.65rem rgba(0, 0, 0, 0.24);
    outline: none;
}

.payment-method-button:active {
    transform: translateY(0.08rem);
}

.payment-method-button:disabled {
    opacity: 0.55;
    cursor: default;
    transform: none;
}

.payment-method-icon {
    display: grid;
    place-items: center;
    width: 3.25rem;
    height: 3.25rem;
    border-radius: 50%;
    background: var(--green-color);
}

.payment-method-icon .__svg {
    width: 2rem;
    height: 2rem;
    fill: #ffffff;
}

.payment-method-button.--cash .payment-method-icon .__svg {
    width: 1.75rem;
    height: 1.75rem;
}

.payment-method-content {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
}

.payment-method-title {
    font-size: 0.8rem;
    font-weight: 700;
    line-height: 1.2;
}

.payment-method-description {
    margin-top: 0.2rem;
    font-size: 0.5rem;
    font-weight: 500;
    line-height: 1.25;
    opacity: 0.75;
}

.payment-method-amount {
    margin-top: 0.45rem;
    color: var(--green-color);
    font-size: 0.85rem;
    font-weight: 700;
}

.payment-methods-empty {
    padding: 1rem;
    border-radius: 0.75rem;
    background: #ffffff;
    box-shadow: 0 0.25rem 0.5rem rgba(0, 0, 0, 0.18);
    font-weight: 600;
    text-align: center;
}

.payment-error {
    padding: 0.65rem;
    border-radius: 0.65rem;
    color: #9e3211;
    background: #fff5f1;
    font-size: 0.65rem;
    font-weight: 600;
    text-align: center;
}

.preorder-navigation {
    display: flex;
    margin-top: 1.5rem;
}

</style>
