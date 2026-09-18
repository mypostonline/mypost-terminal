<script setup>
import { computed, ref, watch } from 'vue';
import { getQrImageUrl } from '@/functions/qrUrl.js';
import { getPrice } from '@/functions/helpers.js';
import vRandomQrAnimation from '@/directives/randomQrAnimation.js';

const props = defineProps({
    orderId: {
        type: [ Number, String ],
        required: true,
    },
    orderUrl: {
        type: String,
        required: true,
    },
    changeAmount: { type: Number, default: 0 },
    cashbackAmount: { type: Number, default: 0 },
    balanceCreditAmount: { type: Number, default: 0 },
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
        <h2>Заказ №{{ orderId }}</h2>
        <p v-if="balanceCreditAmount > 0 || changeAmount > 0 || cashbackAmount > 0" class="order-qr-credit">
            <template v-if="balanceCreditAmount > 0">
                Чтобы зачислить внесённую сумму <strong>{{ getPrice(balanceCreditAmount) }}</strong>
                на баланс, отсканируйте QR-код.
            </template>
            <template v-else-if="changeAmount > 0">
                Чтобы зачислить сдачу <strong>{{ getPrice(changeAmount) }}</strong><template v-if="cashbackAmount > 0">
                    и бонусы на сумму <strong>{{ getPrice(cashbackAmount) }}</strong></template>
                на баланс, отсканируйте QR-код.
            </template>
            <template v-else>
                Чтобы зачислить бонусы на сумму <strong>{{ getPrice(cashbackAmount) }}</strong>
                на баланс, отсканируйте QR-код.
            </template>
        </p>
        <div
            v-if="qrImage && !qrError"
            v-random-qr-animation
            class="order-qr-image"
            :class="{
                '--loaded': qrLoaded,
                'qr-code-frame': qrLoaded,
            }"
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
        <p class="order-qr-description" style="font-weight: 600;">
            Чтобы открыть заказ и посмотреть чек, отсканируйте QR-код.
        </p>
    </section>
</template>

<style scoped>
.order-qr {
    display: grid;
    justify-items: center;
    gap: 0.75rem;
    padding: 1rem;
    text-align: center;
}

.order-qr h3,
.order-qr p {
    margin: 0;
}

.order-qr-image {
    display: grid;
    place-items: center;
    width: min(100%, 17rem);
}

.order-qr-credit strong {
    color: var(--green-color);
    font-weight: 700;
}

.order-qr-loading,
.order-qr-error {
    font-size: 0.7rem;
    font-weight: 600;
}

.order-qr-error {
    color: #b63d12;
}

</style>
