import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import localApi from '@/functions/localApi.js';

const ACTIVE_CASH_STATES = new Set([ 'preparing', 'accepting' ]);

export const usePaymentCapabilitiesStore = defineStore(
    'paymentCapabilities',
    () => {
        const status = ref(null);
        const isLoading = ref(false);
        const error = ref('');

        const methods = computed(() => {
            const vendotek = status.value?.vendotek;
            const billAcceptor = status.value?.billAcceptor;
            const cashPayment = status.value?.cashPayment;
            const cashBusy = ACTIVE_CASH_STATES.has(cashPayment?.state);

            return {
                card: {
                    available: Boolean(vendotek?.available),
                    unavailableLabel: !status.value
                        ? 'Проверяем терминал…'
                        : vendotek?.enabled === false
                            ? 'Оплата картой отключена'
                            : vendotek?.busy
                                ? 'Терминал занят'
                                : 'Терминал карты недоступен',
                },
                cash: {
                    available: Boolean(
                        billAcceptor?.available &&
                        billAcceptor?.state === 'ready' &&
                        !cashBusy
                    ),
                    unavailableLabel: !status.value
                        ? 'Проверяем купюроприёмник…'
                        : cashBusy
                            ? 'Купюроприёмник занят'
                            : billAcceptor?.mode === 'disabled'
                                ? 'Оплата наличными отключена'
                                : 'Купюроприёмник недоступен',
                },
            };
        });

        const refresh = async () => {
            if (isLoading.value) {
                return status.value;
            }

            isLoading.value = true;
            try {
                status.value = await localApi('/api/status', {
                    timeoutMs: 3_000,
                });
                error.value = '';
                return status.value;
            }
            catch (requestError) {
                status.value = null;
                error.value = requestError.message;
                return null;
            }
            finally {
                isLoading.value = false;
            }
        };

        return {
            status,
            methods,
            isLoading,
            error,
            refresh,
        };
    }
);
