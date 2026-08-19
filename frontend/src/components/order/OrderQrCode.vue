<script setup>
import { computed, ref, watch } from 'vue';
import { getQrImageUrl } from '@/functions/qrUrl.js';

const props = defineProps({
    orderId: {
        type: [ Number, String ],
        required: true,
    },
    orderUrl: {
        type: String,
        required: true,
    },
});

const qrImage = computed(() => getQrImageUrl(props.orderUrl));
const qrLoaded = ref(false);
const qrError = ref('');

watch(
    qrImage,
    () => {
        qrLoaded.value = false;
        qrError.value = '';
    }
);

const handleQrLoad = () => {
    qrLoaded.value = true;
};

const handleQrError = () => {
    qrError.value = 'Не удалось показать QR-код заказа';
};
</script>

<template>
    <section class="order-qr mt-6" aria-live="polite">
        <h3>Заказ №{{ orderId }}</h3>
        <p>
            Отсканируйте QR-код, чтобы открыть заказ, получить доступные
            начисления и посмотреть чек.
        </p>

        <div
            v-if="qrImage && !qrError"
            class="order-qr-image"
            :class="{ '--loaded': qrLoaded }"
        >
            <img
                v-show="qrLoaded"
                :src="qrImage"
                :alt="`QR-код заказа №${orderId}`"
                @load="handleQrLoad"
                @error="handleQrError"
            >
            <div v-if="!qrLoaded" class="order-qr-loading">
                Загружаем QR-код заказа…
            </div>
        </div>
        <div v-else-if="qrError" class="order-qr-error">
            {{ qrError }}
        </div>
        <div v-else class="order-qr-loading">
            QR-код заказа недоступен
        </div>
    </section>
</template>

<style scoped>
.order-qr {
    display: grid;
    justify-items: center;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: 0.85rem;
    background: #ffffff;
    text-align: center;
    box-shadow: 0 0.25rem 0.5rem rgba(0, 0, 0, 0.18);
}

.order-qr h3,
.order-qr p {
    margin: 0;
}

.order-qr-image {
    position: relative;
    display: grid;
    place-items: center;
    width: min(100%, 17rem);
    padding: 0.45rem;
    border-radius: 0.65rem;
    background: #ffffff;
}

.order-qr-image::after {
    position: absolute;
    inset: 0;
    border: 0.08rem solid var(--blue-color);
    border-radius: inherit;
    box-shadow:
        0 0 0 0 rgba(57, 119, 196, 0),
        inset 0 0 0 0 rgba(57, 119, 196, 0);
    content: '';
    opacity: 0;
    pointer-events: none;
}

.order-qr-image.--loaded::after {
    opacity: 1;
    animation: order-qr-pulse 1.8s ease-in-out infinite;
}

.order-qr-image img {
    display: block;
    width: 100%;
    height: auto;
}

.order-qr-loading,
.order-qr-error {
    font-size: 0.7rem;
    font-weight: 600;
}

.order-qr-error {
    color: #b63d12;
}

@keyframes order-qr-pulse {
    0%,
    100% {
        border-color: var(--blue-color);
        border-width: 0.08rem;
        box-shadow:
            0 0 0 0 rgba(57, 119, 196, 0),
            inset 0 0 0 0 rgba(57, 119, 196, 0);
    }

    50% {
        border-color: transparent;
        border-width: 0;
        box-shadow:
            0 0 0 0.35rem rgba(57, 119, 196, 0.6),
            inset 0 0 0 0.14rem rgba(57, 119, 196, 0.4);
    }
}

@media (prefers-reduced-motion: reduce) {
    .order-qr-image.--loaded::after {
        animation: none;
    }
}
</style>
