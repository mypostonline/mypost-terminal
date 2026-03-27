<script setup>
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { useOrderStore } from "@/stores/orderStore.js";
import { getPrice } from "@/functions/helpers.js";

const route = useRoute();
const router = useRouter();

const propertyStore = usePropertyStore();
const { isOnline, isNetwork, property, post, program, order } = storeToRefs(propertyStore);

const orderStore = useOrderStore();

const createOrder = async () => {
    const createdOrder = await orderStore.createOrder(order.value);
    if (createdOrder?.id) {
        await router.replace({ path: '/order/' + createdOrder.id });
    }
}
</script>

<template>

    <main>

        <pre>{{ order }}</pre>

        <div class="text-center">
            <svg class="__svg" style="fill: var(--green-color); width: 4rem; height: 4rem;">
                <use xlink:href="#clock-waiting"></use>
            </svg>
            <h2 class="mt-4">Принимаем оплату</h2>
        </div>
        <div class="order-final-list mt-6">
            <div class="header">
                <div class="title">Итоговый список</div>
            </div>
            <div class="content">
                <div class="label">Режим:</div>
                <div class="item">
                    <span>Эконом</span>
                    <span>{{ getPrice(0) }}</span>
                </div>
                <div class="item label" style="color: var(--green-color);">
                    <span>Итого:</span>
                    <span>{{ getPrice(0) }}</span>
                </div>
            </div>
            <div class="footer">
                <div class="item">
                    <span>Зачислено бонусов*</span>
                    <span>{{ getPrice(0) }}</span>
                </div>
            </div>
        </div>
        <div style="font-size: 0.75rem; font-weight: 500; margin-top: 1rem;">*Для операций с бонусами оплачивайте через сервис</div>
        <div class="mt-6 text-center">
            <button class="__button --green" @click="createOrder">
                Оплатить {{ getPrice(order.total_amount) }}
            </button>
        </div>
    </main>

</template>

<style scoped>

</style>