<script setup>
import { onMounted } from "vue";
import { useRoute } from "vue-router";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { useInactivity } from '@/composables/useInactivity';
import AppHeader from "@/AppHeader.vue";

const route = useRoute();

const propertyStore = usePropertyStore();

const DEFAULT_INACTIVITY_SECONDS = 60;
const configuredInactivitySeconds = Number(
    import.meta.env.VITE_INACTIVITY
);
const inactivitySeconds =
    Number.isFinite(configuredInactivitySeconds) &&
    configuredInactivitySeconds > 0
        ? configuredInactivitySeconds
        : DEFAULT_INACTIVITY_SECONDS;

onMounted(async () => {
    await propertyStore.init();
});

useInactivity(inactivitySeconds * 1000);
</script>

<template>
    <app-header />
    <router-view :key="route.fullPath" />
</template>

<style scoped>

</style>
