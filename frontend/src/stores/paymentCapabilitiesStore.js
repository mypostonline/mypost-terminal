import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import localApi from '@/functions/localApi.js';

const ACTIVE_CASH_STATES = new Set([
    'preparing',
    'accepting',
    'fiscalizing',
    'partial_payment',
    'balance_credit_required',
]);

export const usePaymentCapabilitiesStore = defineStore(
    'paymentCapabilities',
    () => {
        const status = ref(null);
        const isLoading = ref(false);
        const error = ref('');

        const methods = computed(() => {
            const cardTerminal = status.value?.cardTerminal;
            const billAcceptor = status.value?.billAcceptor;
            const cashPayment = status.value?.cashPayment;
            const cashFiscalization = status.value?.cashFiscalization;
            const cashBusy = ACTIVE_CASH_STATES.has(cashPayment?.state) || (
                cashPayment?.state === 'attention_required' &&
                Number(cashPayment?.acceptedAmountMinor || 0) > 0
            );
            const cashFiscalizationReady =
                cashFiscalization?.enabled !== true ||
                cashFiscalization?.available === true;

            return {
                card: {
                    available: Boolean(cardTerminal?.available),
                    testMode: cardTerminal?.testMode === true,
                    unavailableLabel: !status.value
                        ? 'Проверяем терминал…'
                        : cardTerminal?.enabled === false
                            ? 'Оплата картой отключена'
                            : cardTerminal?.busy
                                ? 'Терминал занят'
                                : 'Терминал карты недоступен',
                },
                cash: {
                    testMode: billAcceptor?.testMode === true,
                    available: Boolean(
                        billAcceptor?.available &&
                        billAcceptor?.state === 'ready' &&
                        cashFiscalizationReady &&
                        !cashBusy
                    ),
                    unavailableLabel: !status.value
                        ? 'Проверяем купюроприёмник…'
                        : cashBusy
                            ? 'Купюроприёмник занят'
                            : !cashFiscalizationReady
                                ? 'Касса Vendotek недоступна'
                            : billAcceptor?.enabled === false
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
