import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { usePaymentStore } from './paymentStore.js';

const order = {
    id: 42,
    program_id: 7,
    payment_method: 'cash',
    total_amount: 500,
    items: [],
};

describe('payment store', () => {
    beforeEach(() => {
        localStorage.clear();
        setActivePinia(createPinia());
    });

    it('locks navigation while a payment is active', () => {
        const store = usePaymentStore();

        store.prepare(order);
        expect(store.isNavigationLocked).toBe(true);
        expect(store.isRecoverableOrder(42)).toBe(true);

        store.markProcessing(order);
        store.markApproved(500);
        expect(store.phase).toBe('reconciling');
        expect(store.isNavigationLocked).toBe(true);

        store.markCompleted();
        expect(store.isNavigationLocked).toBe(false);
    });

    it('does not persist or restore reconciliation after a reload', () => {
        const firstStore = usePaymentStore();
        firstStore.prepare(order);
        firstStore.markApproved(500);

        expect(localStorage.getItem('mypost.activePayment')).toBeNull();

        setActivePinia(createPinia());
        const restoredStore = usePaymentStore();

        expect(restoredStore.phase).toBe('idle');
        expect(restoredStore.paidAmount).toBeNull();
        expect(restoredStore.isRecoverableOrder('42')).toBe(false);
    });

    it('unlocks navigation only for a safe failure', () => {
        const store = usePaymentStore();
        store.prepare(order);
        store.markFailed('declined');

        expect(store.phase).toBe('failed');
        expect(store.isNavigationLocked).toBe(false);
    });

    it('removes payment data saved by an older version', () => {
        localStorage.setItem('mypost.activePayment', JSON.stringify({
            phase: 'attention_required',
            orderSnapshot: order,
        }));

        usePaymentStore();

        expect(localStorage.getItem('mypost.activePayment')).toBeNull();
    });
});
