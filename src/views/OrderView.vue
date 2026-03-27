<script setup>
import { onBeforeMount } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useOrderStore } from "@/stores/orderStore.js";

const route = useRoute();

const orderStore = useOrderStore();
const { isLoading, order } = storeToRefs(orderStore);

onBeforeMount(async () => {
    await orderStore.getOrder(route.params.orderId);
});

</script>

<template>

    <main>
        {{ isLoading }}
        {{ order }}
    </main>

</template>

<style scoped>

</style>