<script setup>
import { ref, watch } from 'vue';
import QRCode from 'qrcode';

const props = defineProps({
    changeCredit: {
        type: Object,
        required: true,
    },
});

const qrImage = ref('');
const qrError = ref('');

const formatMoney = amountMinor => {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(Number(amountMinor || 0) / 100);
};

watch(
    () => props.changeCredit?.qrPayload,
    async qrPayload => {
        qrImage.value = '';
        qrError.value = '';

        if (!qrPayload) {
            return;
        }

        try {
            const generatedImage = await QRCode.toDataURL(qrPayload, {
                width: 320,
                margin: 2,
                errorCorrectionLevel: 'M',
                color: {
                    dark: '#224062',
                    light: '#ffffff',
                },
            });

            if (qrPayload === props.changeCredit?.qrPayload) {
                qrImage.value = generatedImage;
            }
        }
        catch (error) {
            console.error('Failed to render cash change QR', error);
            qrError.value = 'Не удалось показать QR-код. Вызовите оператора';
        }
    },
    { immediate: true }
);
</script>

<template>
    <section class="cash-change-credit mt-6" aria-live="polite">
        <h3>Ваша сдача — {{ formatMoney(changeCredit.amountMinor) }}</h3>

        <template v-if="changeCredit.qrPayload">
            <p>
                Отсканируйте QR-код телефоном, чтобы зачислить сдачу.
            </p>
            <div v-if="qrImage" class="cash-change-credit-qr">
                <img
                    :src="qrImage"
                    :alt="`QR-код для зачисления сдачи ${formatMoney(changeCredit.amountMinor)}`"
                >
            </div>
            <div v-else-if="qrError" class="cash-change-credit-error">
                {{ qrError }}
            </div>
            <div v-else class="cash-change-credit-loading">
                Формируем QR-код…
            </div>
            <p class="cash-change-credit-note">
                Не закрывайте этот экран, пока не отсканируете код.
            </p>
        </template>

        <div v-else class="cash-change-credit-error">
            Сдача зафиксирована, но сервис зачисления не настроен.
            Вызовите оператора и не начинайте новую оплату.
        </div>
    </section>
</template>

<style scoped>
.cash-change-credit {
    display: grid;
    justify-items: center;
    gap: 0.75rem;
    padding: 1rem;
    border: 0.12rem solid var(--green-color);
    border-radius: 0.85rem;
    background: #ffffff;
    text-align: center;
    box-shadow: 0 0.25rem 0.5rem rgba(0, 0, 0, 0.14);
}

.cash-change-credit h3,
.cash-change-credit p {
    margin: 0;
}

.cash-change-credit-qr {
    display: grid;
    place-items: center;
    width: min(100%, 17rem);
    padding: 0.45rem;
    border-radius: 0.65rem;
    background: #ffffff;
}

.cash-change-credit-qr img {
    display: block;
    width: 100%;
    height: auto;
}

.cash-change-credit-loading,
.cash-change-credit-note,
.cash-change-credit-error {
    font-size: 0.7rem;
    font-weight: 600;
}

.cash-change-credit-note {
    color: rgba(34, 64, 98, 0.78);
}

.cash-change-credit-error {
    color: #b63d12;
}
</style>
