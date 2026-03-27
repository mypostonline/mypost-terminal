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

        <div class="mt-6 text-center">
            <button class="__button --green" @click="createOrder">
                Оплатить {{ getPrice(order.total_amount) }}
            </button>
        </div>
    </main>

</template>

<style scoped>

</style>