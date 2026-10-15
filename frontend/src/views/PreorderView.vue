<script setup>
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { useOrderStore } from "@/stores/orderStore.js";
import { usePaymentStore } from "@/stores/paymentStore.js";
import { usePaymentCapabilitiesStore } from "@/stores/paymentCapabilitiesStore.js";
import { getPrice } from "@/functions/helpers.js";
import { computed, onBeforeMount, onBeforeUnmount, onMounted, ref } from "vue";
import CallSupportComponent from "@/components/CallSupportComponent.vue";
import FixedActions from "@/components/FixedActions.vue";
import OfferLinkComponent from "@/components/OfferLinkComponent.vue";
import { getConfiguredPaymentMethods, SBP_PAYMENT_METHOD } from "@/config/paymentMethods.js";
import { isPostAcceptingOrders } from "@/config/postAvailability.js";

const router = useRouter();
const route = useRoute();

const propertyStore = usePropertyStore();
const { property, post, program, order, hasAdditionalServices } = storeToRefs(propertyStore);

onBeforeMount(() => {
    if (program.value.id === Number(route.params.programId)) return;
    if (!propertyStore.setProgram(route.params.programId)) {
        router.replace('/programs');
    }
});

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

const paymentMethodOrder = ['card', 'sbp', 'cash'];
const paymentMethods = computed(() => {
    const configured = getConfiguredPaymentMethods(
    post.value,
    runtimePaymentMethods.value
    );
    if (!configured.some(method => method.code === 'sbp')) configured.push(SBP_PAYMENT_METHOD);
    return configured.sort((a, b) => (
    paymentMethodOrder.indexOf(a.code) - paymentMethodOrder.indexOf(b.code)
)).map(method => {
    if ((method.code === 'sbp' && !method.available) || isPostAcceptingOrders(post.value)) {
        return method;
    }
    return {
        ...method,
        available: false,
        unavailableLabel: 'Пост временно недоступен',
    };
});
});

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
        if (paymentMethod.code !== 'sbp') await paymentCapabilitiesStore.refresh();
        const currentPaymentMethod = paymentMethods.value.find(
            item => item.code === paymentMethod.code
        );

        if (!currentPaymentMethod?.available) {
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

    <main class="preorder-view">
        <div class="text-center">
            <svg class="__svg" style="color: var(--green-color); width: 4rem; height: 4rem;">
                <use xlink:href="#clock-waiting"></use>
            </svg>
            <h2 class="mt-4">В заказе</h2>
        </div>
        <div class="order-final-list mt-6">
            <div class="header">
                <div class="title">Итоговый список</div>
            </div>
            <div class="content" tabindex="0" role="region" aria-label="Позиции заказа">
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
                            <span>{{ addon.isIncluded ? 'Включено' : addon.isComposite ? 'В составе' : getPrice(addon.price) }}</span>
                        </div>
                    </template>
                </template>
            </div>
            <div class="footer">
                <div class="item label" style="color: var(--green-color);">
                    <span>Итого:</span>
                    <span>{{ getPrice(order.total_amount) }}</span>
                </div>
                <div class="item">
                    <span>Начислено бонусов*</span>
                    <span>{{ getPrice(order.cashback_amount) }}</span>
                </div>
            </div>
        </div>
        <div
            style="font-size: 0.75rem; font-weight: 500; margin-top: 1rem;"
        >
            *Для зачисления бонусов, сканируй QR-код после оплаты заказа
        </div>
        <section class="payment-choice mt-6" aria-labelledby="payment-choice-title">
            <h2 id="payment-choice-title" class="payment-choice-title">Выберите способ оплаты</h2>
            <div
                v-if="paymentMethods.length"
                class="payment-methods"
                :style="{ '--payment-method-count': paymentMethods.length }"
            >
                <div
                    v-for="paymentMethod in paymentMethods"
                    :key="paymentMethod.code"
                >
                    <button
                        class="__button --tile"
                        type="button"
                        :aria-label="`${selectedPaymentMethod === paymentMethod.code ? 'Создаём заказ…' : paymentMethod.actionLabel}: ${getPrice(order.total_amount)}`"
                        :disabled="
                            isCreatingOrder ||
                            (isCheckingPayments && paymentMethod.code !== 'sbp') ||
                            !paymentMethod.available
                        "
                        @click="createOrder(paymentMethod)"
                    >
                        <span class="__button-icon">
                            <svg class="__svg" aria-hidden="true">
                                <use :xlink:href="`#${paymentMethod.icon}`"></use>
                            </svg>
                        </span>
                        <span>
                            {{
                                selectedPaymentMethod === paymentMethod.code
                                    ? 'Создаём заказ…'
                                    : paymentMethod.label
                            }}
                        </span>
                    </button>
                </div>
            </div>
            <div v-if="createError" class="payment-error mt-4" role="alert">
                {{ createError }}
            </div>
        </section>
        <div style="font-weight: 600; margin-top: 1rem; text-align: center; font-size: 0.85em;">Сдача наличными не выдаётся. Чтобы зачислить её на баланс вашего личного кабинета, отсканируйте QR-код заказа после оплаты.</div>
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

        <fixed-actions label="Действия с предзаказом">
            <template #leading>
                <router-link
                    v-if="!isCreatingOrder"
                    :to="hasAdditionalServices ? `/programs/${program.id}` : '/programs'"
                    class="__button"
                    aria-label="Назад"
                    title="Назад"
                >
                    <svg class="__svg --back" aria-hidden="true">
                        <use xlink:href="#arrow"></use>
                    </svg>
                </router-link>
                <button v-else class="__button" type="button" aria-label="Назад" title="Назад" disabled>
                    <svg class="__svg --back" aria-hidden="true">
                        <use xlink:href="#arrow"></use>
                    </svg>
                </button>
            </template>
            <template #trailing>
                <call-support-component :show-text="false" />
            </template>
        </fixed-actions>
    </main>

</template>

<style scoped>

.preorder-view,
.preorder-view .order-final-list .item > span {
    min-width: 0;
    overflow-wrap: anywhere;
}

.preorder-view .order-final-list .item {
    flex-wrap: wrap;
}

.payment-choice-title {
    margin-bottom: 0.75rem;
    text-align: center;
}

.payment-methods {
    display: grid;
    grid-template-columns: repeat(var(--payment-method-count), minmax(0, 1fr));
    align-items: start;
    gap: 0.75rem;
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

</style>
