<script setup>
import { storeToRefs } from "pinia";
import { usePropertyStore } from "@/stores/propertyStore.js";

const propertyStore = usePropertyStore();
const { isSupportCalled, secondsLeft } = storeToRefs(propertyStore);
</script>

<template>

    <button class="__button" :disabled="isSupportCalled" @click="propertyStore.callSupport">
        <svg class="__svg" style="fill: var(--primary-color)">
            <use xlink:href="#call"></use>
        </svg>
        <span class="__waiting is-waiting" v-show="isSupportCalled">Вызываем {{ secondsLeft }}</span>
        <span v-show="!isSupportCalled">Вызов оператора</span>
    </button>

</template>

<style scoped>

</style>