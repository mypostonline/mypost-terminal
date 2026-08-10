<script setup>
import { storeToRefs } from "pinia";
import { useRoute } from "vue-router";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { usePaymentStore } from "@/stores/paymentStore.js";

const route = useRoute();

const propertyStore = usePropertyStore();
const { property } = storeToRefs(propertyStore);
const paymentStore = usePaymentStore();
const { isNavigationLocked } = storeToRefs(paymentStore);

</script>

<template>

    <header>
        <div class="logo">
            <span v-if="isNavigationLocked" class="logo-static">
                <img src="/assets/images/logo.svg" alt="MYPOST">
            </span>
            <router-link v-else to="/">
                <img src="/assets/images/logo.svg" alt="MYPOST">
            </router-link>
        </div>
        <div class="schedule">
            <template v-if="property?.id">
                <span v-if="route.name === 'program'">Сухая уборка {{ property.dry_working_hours }}</span>
                <span v-else>Режим работы {{ property.working_hours }}</span>
            </template>
        </div>
    </header>

</template>

<style scoped>

</style>
