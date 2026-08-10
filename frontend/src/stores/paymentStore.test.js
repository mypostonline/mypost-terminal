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
        expect(localStorage.getItem('mypost.activePayment')).toBeNull();
    });

    it('restores reconciliation after a reload', () => {
        const firstStore = usePaymentStore();
        firstStore.prepare(order);
        firstStore.markApproved(500);

        setActivePinia(createPinia());
        const restoredStore = usePaymentStore();

        expect(restoredStore.phase).toBe('reconciling');
        expect(restoredStore.paidAmount).toBe(500);
        expect(restoredStore.isRecoverableOrder('42')).toBe(true);
    });

    it('unlocks navigation only for a safe failure', () => {
        const store = usePaymentStore();
        store.prepare(order);
        store.markFailed('declined');

        expect(store.phase).toBe('failed');
        expect(store.isNavigationLocked).toBe(false);
    });

    it('persists a completed cash change claim for page reload', () => {
        const firstStore = usePaymentStore();
        firstStore.prepare(order);
        firstStore.setChangeCredit({
            status: 'pending',
            amountMinor: 2_000,
            qrPayload: 'https://app.example/change?token=signed',
            expiresAt: '2026-08-11T10:00:00.000Z',
        });
        firstStore.markApproved(520);
        firstStore.markCompleted();

        expect(firstStore.isNavigationLocked).toBe(false);
        expect(firstStore.hasPendingChangeCredit).toBe(true);
        expect(localStorage.getItem('mypost.activePayment')).not.toBeNull();

        setActivePinia(createPinia());
        const restoredStore = usePaymentStore();

        expect(restoredStore.phase).toBe('completed');
        expect(restoredStore.changeCredit.amountMinor).toBe(2_000);
        expect(restoredStore.hasChangeCreditForOrder('42')).toBe(true);
    });

    it('clears change data when a different payment starts', () => {
        const store = usePaymentStore();
        store.prepare(order);
        store.setChangeCredit({
            amountMinor: 2_000,
            qrPayload: 'https://app.example/change?token=signed',
        });
        store.markCompleted();

        store.markProcessing({ ...order, id: 43 });

        expect(store.changeCredit).toBeNull();
        expect(store.paidAmount).toBeNull();
    });
});
