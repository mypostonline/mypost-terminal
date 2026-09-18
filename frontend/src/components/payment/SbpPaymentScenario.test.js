import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SbpPaymentScenario from './SbpPaymentScenario.vue';
import { createSbpPayment, getSbpPayment, cancelSbpPayment } from '@/functions/sbpPaymentApi.js';

vi.mock('@/functions/sbpPaymentApi.js', () => ({ createSbpPayment: vi.fn(), getSbpPayment: vi.fn(), cancelSbpPayment: vi.fn() }));
let wrapper;
let payment;
const order = { id: 91, total_amount: 1250, items: [], payment_method: 'sbp' };
const open = async () => {
    wrapper = mount(SbpPaymentScenario, { props: { order } });
    await flushPromises();
};
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    payment = { id: 'p1', order_id: 91, status: 'pending', amount_minor: 125000, currency: 'RUB',
        qr_payload: 'https://bank.example/pay/123', expires_at: new Date(Date.now() + 60000).toISOString() };
    createSbpPayment.mockReset().mockResolvedValue({ payment });
    getSbpPayment.mockReset().mockResolvedValue({ payment });
    cancelSbpPayment.mockReset();
});
afterEach(() => { wrapper?.unmount(); vi.useRealTimers(); });

it('shows the bank QR and completes only with a server-paid order', async () => {
    await open();
    expect(wrapper.get('img').attributes('src')).toContain(encodeURIComponent(payment.qr_payload));
    await wrapper.get('img').trigger('load');
    expect(wrapper.get('.sbp-payment-qr-image').classes()).toContain('--loaded');
    expect(wrapper.get('.sbp-payment-qr-image').classes()).toContain('qr-code-frame');
    expect(wrapper.emitted('server-paid')).toBeUndefined();
    const paid = { ...order, status: 'paid', uuid: 'order-91' };
    getSbpPayment.mockResolvedValue({ payment: { ...payment, status: 'paid' }, order: paid });
    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.emitted('server-paid')).toEqual([[paid]]);
    await vi.advanceTimersByTimeAsync(6000);
    expect(getSbpPayment).toHaveBeenCalledTimes(1);
});

it('does not confirm a mismatched payment or unconfirmed order', async () => {
    createSbpPayment.mockResolvedValue({ payment: { ...payment, amount_minor: 1 } });
    await open();
    expect(wrapper.find('img').exists()).toBe(false);
    getSbpPayment.mockResolvedValue({ payment: { ...payment, status: 'paid' }, order: { ...order, status: 'created' } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.emitted('server-paid')).toBeUndefined();
    expect(wrapper.text()).toContain('Не оплачивайте повторно');
});

it('keeps polling after a network error and hides expired QR without assuming failure', async () => {
    await open();
    getSbpPayment.mockRejectedValue(new Error('Нет связи'));
    await vi.advanceTimersByTimeAsync(61000);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.emitted('failed')).toBeUndefined();
    getSbpPayment.mockResolvedValue({ payment: { ...payment, status: 'expired' } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.emitted('failed')).toHaveLength(1);
});

it('handles payment winning a cancellation race', async () => {
    await open();
    const paid = { ...order, status: 'paid' };
    cancelSbpPayment.mockResolvedValue({ payment: { ...payment, status: 'paid' }, order: paid });
    await wrapper.vm.actions[0].run();
    expect(wrapper.emitted('server-paid')).toEqual([[paid]]);
    expect(wrapper.emitted('canceled')).toBeUndefined();
});

it('retries ambiguous creation with the same order and stops polling after unmount', async () => {
    createSbpPayment.mockRejectedValueOnce(new Error('Timeout'));
    await open();
    await wrapper.vm.actions[0].run();
    expect(createSbpPayment.mock.calls.map(call => call[0])).toEqual([91, 91]);
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(getSbpPayment).not.toHaveBeenCalled();
});
