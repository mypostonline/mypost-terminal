<script setup>
import { onBeforeMount, computed, ref } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useOrderStore } from "@/stores/orderStore.js";
import { getPrice } from "@/functions/helpers.js";
import { usePropertyStore } from "@/stores/propertyStore.js";
import CallSupportComponent from "@/components/CallSupportComponent.vue";

const route = useRoute();

const propertyStore = usePropertyStore();
const { property } = storeToRefs(propertyStore);

const orderStore = useOrderStore();
const { isLoading, order } = storeToRefs(orderStore);


onBeforeMount(async () => {
    await orderStore.getOrder(route.params.orderId);
    if (order.value.total_amount) {
        const response = payOrder(order.value.total_amount);
    }
});

const isInit = ref(false);
const isPayment = ref(false);
const isPaid = ref(false);

const payOrder = async (amountMinor) => {
    isInit.value = true;
    isPayment.value = true;
    const res = await fetch('/api/pay', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            amountMinor: amountMinor * 100,
            productId: 1,
            productName: 'Мойка',
        }),
    });
    const response = await res.json();
    console.log('response', response);
    isPayment.value = false;
    if (response?.result?.approved) {
        await orderStore.paidOrder(order.value.id, response.result?.approvedAmount);
        isPaid.value = true;
    }
    else {
        isPaid.value = false;
    }
    return response;
}

const program = computed(() => {
    return order.value?.items?.find(item => item.program_id);
});

const addons = computed(() => {
    return order.value?.items?.filter(item => item.addon_id);
});

</script>

<template>

    <main v-if="order.id && isInit">
        <div class="text-center">
            <template v-if="isPayment">
                <svg class="__svg" style="fill: var(--green-color); width: 4rem; height: 4rem;">
                    <use xlink:href="#clock-waiting"></use>
                </svg>
                <h2 class="mt-4">Принимаем оплату</h2>
            </template>
            <template v-else>
                <template v-if="isPaid">
                    <svg class="__svg" style="fill: var(--green-color); width: 4rem; height: 4rem;">
                        <use xlink:href="#clock-ok"></use>
                    </svg>
                    <h2 class="mt-4">Оплата принята</h2>
                </template>
                <template v-else>
                    <svg class="__svg" style="fill: var(--green-color); width: 4rem; height: 4rem;">
                        <use xlink:href="#clock-error"></use>
                    </svg>
                    <h2 class="mt-4">Оплата не принята</h2>
                </template>
            </template>
        </div>
        <template v-if="isPayment">
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
                    <template v-if="addons.length > 0">
                        <div class="label">Дополнительные услуги:</div>
                        <template v-for="(addon, index) in addons">
                            <div class="item">
                                <span>{{ addon.name }}</span>
                                <span>{{ getPrice(addon.price) }}</span>
                            </div>
                        </template>
                    </template>
                    <div class="item label" style="color: var(--green-color);">
                        <span>Итого:</span>
                        <span>{{ getPrice(order.total_amount) }}</span>
                    </div>
                </div>
                <div class="footer">
                    <div class="item">
                        <span>Зачислено бонусов*</span>
                        <span>{{ getPrice(0) }}</span>
                    </div>
                </div>
            </div>
            <div class="mt-6 text-center">
                <div style="font-weight: 600;">Приложите карту к терминалу NFC</div>
            </div>
            <div class="mt-6 text-center">
                <svg class="__svg" style="fill: var(--primary-color); width: 10rem; height: 7rem;"
                     :style="{ fill: isInit ? 'var(--green-color)' : 'var(--primary-color)' }">
                    <use xlink:href="#nfc"></use>
                </svg>
            </div>
        </template>
        <template v-else>
            <template v-if="isPaid">
                <h3 class="mt-4 text-center">Благодарим Вас за использование<br> нашего сервиса</h3>
                <div class="mt-16">
                    <div class="text-center">
                        <router-link to="/" class="__button --green">На главную</router-link>
                    </div>
                </div>
            </template>
            <template v-else>
                <h2 class="mt-4 text-center">Повторите попытку<br> или смените способ оплаты</h2>
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
                <div class="mt-16" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; align-items: center;">
                    <div>
                        <router-link to="/" class="__button --green">На главную</router-link>
                    </div>
                    <div class="text-right">
                        <router-link :to="`/programs/${order.program_id}`" class="__button">Повторить попытку</router-link>
                    </div>
                </div>
            </template>
        </template>
        <div class="mt-6 text-center">
            <call-support-component />
        </div>
        <div class="mt-4 text-center">
            <input type="checkbox" checked disabled>
            Заплатив здесь, вы принимаете условия сервиса, платежного агрегатора и <a
            v-if="property?.proprietor?.public_offer_url" :href="property.proprietor.public_offer_url" target="_blank">оферты</a>
        </div>
    </main>

</template>

<style scoped>

</style>