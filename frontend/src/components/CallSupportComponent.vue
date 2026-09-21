<script setup>
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { usePropertyStore } from "@/stores/propertyStore.js";

defineProps({
    showText: {
        type: Boolean,
        default: true,
    },
});

const propertyStore = usePropertyStore();
const {
    isSupportCalled,
    secondsLeft,
    supportState,
    supportError,
} = storeToRefs(propertyStore);

const supportLabel = computed(() => {
    if (supportState.value === 'calling') {
        return 'Отправляем вызов…';
    }
    if (supportState.value === 'sent') {
        return `Оператор вызван, осталось ${secondsLeft.value}`;
    }
    if (supportState.value === 'error') {
        return 'Повторить вызов оператора';
    }
    return 'Вызов оператора';
});
</script>

<template>

    <button
        class="__button support-button"
        :class="{
            '--error': supportState === 'error',
            '--icon-only': !showText,
        }"
        :aria-label="supportLabel"
        :title="showText ? undefined : supportLabel"
        :disabled="isSupportCalled"
        @click="propertyStore.callSupport"
    >
        <svg v-if="showText || supportState !== 'sent'" class="__svg" style="color: var(--primary-color)">
            <use xlink:href="#call"></use>
        </svg>
        <template v-if="showText">
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
        </template>
        <span v-else-if="supportState === 'sent'" class="support-countdown">{{ secondsLeft }}</span>
    </button>
    <div
        v-if="showText && supportState === 'error'"
        class="support-error"
        role="alert"
    >
        {{ supportError }}
    </div>

</template>

<style scoped>
.support-button {
    white-space: nowrap;
}

.support-button.--error {
    border-color: #e8541e;
}

.support-countdown {
    font-variant-numeric: tabular-nums;
}

.support-button.--icon-only {
    min-width: initial;
    padding: 0.75rem;
}

.support-error {
    margin-top: 0.35rem;
    color: #9e3211;
    font-size: 0.55rem;
    font-weight: 600;
}
</style>
