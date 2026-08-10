<script setup>
import { storeToRefs } from "pinia";
import { usePropertyStore } from "@/stores/propertyStore.js";

const propertyStore = usePropertyStore();
const {
    isSupportCalled,
    secondsLeft,
    supportState,
    supportError,
} = storeToRefs(propertyStore);
</script>

<template>

    <button
        class="__button support-button"
        :class="{ '--error': supportState === 'error' }"
        :disabled="isSupportCalled"
        @click="propertyStore.callSupport"
    >
        <svg class="__svg" style="fill: var(--primary-color)">
            <use xlink:href="#call"></use>
        </svg>
        <span v-if="supportState === 'calling'">
            Отправляем вызов…
        </span>
        <span v-else-if="supportState === 'sent'">
            Оператор вызван {{ secondsLeft }}
        </span>
        <span v-else-if="supportState === 'error'">
            Повторить вызов
        </span>
        <span v-else>Вызов оператора</span>
    </button>
    <div
        v-if="supportState === 'error'"
        class="support-error"
        role="alert"
    >
        {{ supportError }}
    </div>

</template>

<style scoped>
.support-button.--error {
    border-color: #e8541e;
}

.support-error {
    margin-top: 0.35rem;
    color: #9e3211;
    font-size: 0.55rem;
    font-weight: 600;
}
</style>
