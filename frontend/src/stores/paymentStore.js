import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

const LEGACY_STORAGE_KEY = 'mypost.activePayment';
const LOCKED_PHASES = new Set([
    'prepared',
    'processing',
    'reconciling',
    'attention_required',
]);

const clearLegacyStoredPayment = () => {
    try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    catch {
        // Browser storage can be unavailable in a restricted webview.
    }
};

const sanitizeOrder = order => ({
    id: order?.id,
    program_id: order?.program_id,
    payment_method: order?.payment_method,
    total_amount: order?.total_amount,
    items: Array.isArray(order?.items) ? order.items : [],
});

export const usePaymentStore = defineStore('paymentStore', () => {
    clearLegacyStoredPayment();

    const phase = ref('idle');
    const orderSnapshot = ref(null);
    const paidAmount = ref(null);
    const error = ref('');

    const orderId = computed(() => orderSnapshot.value?.id);
    const isNavigationLocked = computed(() => LOCKED_PHASES.has(phase.value));

    const prepare = order => {
        orderSnapshot.value = sanitizeOrder(order);
        paidAmount.value = null;
        error.value = '';
        phase.value = 'prepared';
    };

    const markProcessing = order => {
        if (order?.id) {
            const isSameOrder = String(orderSnapshot.value?.id || '') ===
                String(order.id);
            orderSnapshot.value = sanitizeOrder(order);
            if (!isSameOrder) {
                paidAmount.value = null;
            }
        }
        phase.value = 'processing';
        error.value = '';
    };

    const markApproved = amount => {
        paidAmount.value = Number(amount);
        phase.value = 'reconciling';
        error.value = '';
    };

    const markReconciliationRequired = message => {
        phase.value = 'reconciling';
        error.value = message || '';
    };

    const markAttentionRequired = message => {
        phase.value = 'attention_required';
        error.value = message || '';
    };

    const markCompleted = () => {
        phase.value = 'completed';
        error.value = '';
    };

    const markFailed = message => {
        phase.value = 'failed';
        error.value = message || '';
    };

    const clear = () => {
        phase.value = 'idle';
        orderSnapshot.value = null;
        paidAmount.value = null;
        error.value = '';
    };

    const matchesOrder = candidateOrderId => {
        return String(orderId.value || '') ===
            String(candidateOrderId || '');
    };

    const isRecoverableOrder = candidateOrderId => {
        return matchesOrder(candidateOrderId) &&
            LOCKED_PHASES.has(phase.value);
    };

    return {
        phase,
        orderSnapshot,
        orderId,
        paidAmount,
        error,
        isNavigationLocked,
        prepare,
        markProcessing,
        markApproved,
        markReconciliationRequired,
        markAttentionRequired,
        markCompleted,
        markFailed,
        clear,
        matchesOrder,
        isRecoverableOrder,
    };
});
