<script setup>
import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { useInactivity } from '@/composables/useInactivity';
import AppHeader from "@/AppHeader.vue";

const route = useRoute();
const router = useRouter();

const propertyStore = usePropertyStore();
const { isInitialized } = storeToRefs(propertyStore);

onMounted(async () => {
    if (route.name !== 'home') {
        //await router.replace({ path: '/' });
    }
    await propertyStore.init();
});

useInactivity(60_000);
</script>

<template>

    <template v-if="isInitialized">
        <app-header />
        <router-view :key="route.fullPath" />
    </template>

</template>

<style scoped>

</style>
