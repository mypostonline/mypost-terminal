import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrderView from './OrderView.vue';
import { useOrderStore } from '@/stores/orderStore.js';
import { usePaymentStore } from '@/stores/paymentStore.js';
import localApi from '@/functions/localApi.js';
import { creditCashToBalance } from '@/functions/cashOrderApi.js';
import { createSbpPayment } from '@/functions/sbpPaymentApi.js';

vi.mock('@/functions/sbpPaymentApi.js', () => ({ createSbpPayment: vi.fn(), getSbpPayment: vi.fn(), cancelSbpPayment: vi.fn() }));

vi.mock('@/functions/localApi.js', () => ({ default: vi.fn() }));
vi.mock('@/functions/cashOrderApi.js', () => ({
    recordCashBill: vi.fn().mockResolvedValue({}),
    creditCashToBalance: vi.fn().mockResolvedValue({}),
}));

let wrapper;
let session;
let device;
let orderStore;
let paymentStore;
let router;
let sockets;

const buttons = () => [...document.querySelectorAll('.fixed-actions button')];
const button = label => new DOMWrapper([...document.querySelectorAll('.fixed-actions button, .order-payment-actions button')].find(el => el.textContent.trim() === label));
const homeLink = () => document.querySelector('.fixed-actions a');

const openOrder = async (overrides = {}, { missing = false } = {}) => {
    const pinia = createPinia();
    orderStore = useOrderStore(pinia);
    paymentStore = usePaymentStore(pinia);
    const order = {
        id: 91, program_id: 1, total_amount: 1250, status: 'created',
        payment_method: 'card', items: [], ...overrides,
    };
    vi.spyOn(orderStore, 'getOrder').mockImplementation(async () => {
        orderStore.setOrder(missing ? {} : order);
        return missing ? null : order;
    });
    vi.spyOn(orderStore, 'paidOrder').mockResolvedValue({});
    vi.spyOn(orderStore, 'refreshOrder').mockImplementation(async () => {
        orderStore.setOrder({ ...order, status: 'paid' });
        return orderStore.order;
    });
    router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'home', component: { template: '<div>Главная</div>' } },
            { path: '/order/:orderId', component: OrderView },
        ],
    });
    await router.push('/order/91');
    wrapper = mount(OrderView, {
        attachTo: document.body,
        global: { plugins: [pinia, router], stubs: { OrderQrCode: true } },
    });
    await flushPromises();
    expect(document.querySelectorAll('.fixed-actions')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('Заплатив здесь');
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.findAll('main .__button').every(button => (
        button.element.closest('.payment-test-actions, .cash-test-actions, .order-payment-actions')
    ))).toBe(true);
    expect(buttons().filter(el => el.getAttribute('aria-label') === 'Вызов оператора')).toHaveLength(1);
};

const updateSession = async (channel, changes) => {
    session = { ...session, ...changes };
    sockets[0].dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ channel, payload: { session } }),
    }));
    await flushPromises();
};

beforeEach(() => {
    sockets = [];
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('WebSocket', class extends EventTarget {
        constructor() { super(); sockets.push(this); }
        close() {}
    });
    session = {
        id: 'session-91', orderId: 91, state: 'processing',
        acceptedAmountMinor: 0, remainingAmountMinor: 125000,
    };
    device = { testMode: false, supportedAmountsRub: [100, 500, 1000] };
    localApi.mockReset();
    localApi.mockImplementation(async () => ({ session, device, acceptor: device }));
    creditCashToBalance.mockReset().mockResolvedValue({});
});

afterEach(() => {
    wrapper?.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

describe('OrderView fixed actions', () => {
    it('uses the backend-paid SBP order without calling the client paid endpoint or devices', async () => {
        createSbpPayment.mockResolvedValue({
            payment: { id: 'sbp-91', order_id: 91, status: 'paid', amount_minor: 125000, currency: 'RUB' },
            order: { id: 91, total_amount: 1250, payment_method: 'sbp', status: 'paid', uuid: 'order-91', change_amount: 0, items: [] },
        });
        await openOrder({ payment_method: 'sbp' });
        expect(wrapper.text()).toContain('Оплата принята');
        expect(orderStore.paidOrder).not.toHaveBeenCalled();
        expect(localApi).not.toHaveBeenCalled();
        expect(paymentStore.phase).toBe('completed');
        expect(wrapper.getComponent({ name: 'OrderQrCode' }).props('orderUrl')).toContain('order-91');
    });


    it('keeps the decision timer in device status after cash acceptance times out', async () => {
        const now = Date.now();
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
        try {
            session = { ...session, state: 'accepting', acceptanceDeadlineAt: new Date(now + 30000).toISOString() };
            await openOrder({ payment_method: 'cash' });
            const timer = () => wrapper.get('.cash-device-status .cash-device-timer');
            expect(timer().text()).toBe('00:30');
            await updateSession('cash-payment', {
                state: 'partial_payment', acceptedAmountMinor: 10000,
                acceptanceDeadlineAt: new Date(now - 1000).toISOString(),
                decisionDeadlineAt: new Date(now + 60000).toISOString(),
            });
            expect(wrapper.find('.cash-partial-payment').exists()).toBe(false);
            expect(timer().text()).toBe('01:00');
            expect(timer().attributes('aria-label')).toContain('выбор действия');
            expect(button('Продолжить оплату').exists()).toBe(true);
            expect(button('Зачислить на баланс').exists()).toBe(true);
            await updateSession('cash-payment', {
                state: 'accepting', acceptanceDeadlineAt: new Date(now + 45000).toISOString(),
            });
            expect(timer().text()).toBe('00:45');
            expect(timer().attributes('aria-label')).toContain('внесение купюры');
        } finally {
            clock.mockRestore();
        }
    });

    it.each(['paid', 'canceled', 'failed'])('keeps home and support in the panel for %s orders', async status => {
        await openOrder({ status });
        expect(homeLink().textContent).toContain('На главную');
        expect(homeLink().querySelector('use').getAttribute('xlink:href')).toBe('#home');
        expect(buttons()).toHaveLength(1);
    });

    it('keeps navigation available when the order cannot be opened', async () => {
        await openOrder({}, { missing: true });
        expect(wrapper.text()).toContain('Не удалось открыть заказ');
        expect(homeLink()).not.toBeNull();
    });

    it('runs card cancellation from the panel and blocks duplicate clicks', async () => {
        await openOrder();
        expect(button('Отменить и начать заново').classes()).toContain('--white');
        expect(button('Отменить и начать заново').find('svg').exists()).toBe(false);
        expect(homeLink()).toBeNull();
        localApi.mockImplementation(url => url === '/api/card/cancel'
            ? new Promise(() => {})
            : Promise.resolve({ session, device }));
        await button('Отменить и начать заново').trigger('click');
        expect(localApi).toHaveBeenCalledWith('/api/card/cancel', expect.objectContaining({
            data: { sessionId: 'session-91', orderId: 91 },
        }));
        expect(button('Отменяем оплату…').element.disabled).toBe(true);
    });

    it('replaces card actions with home after approval and reconciliation', async () => {
        device.testMode = true;
        await openOrder();
        localApi.mockImplementation(async url => ({
            session: url === '/api/card/mock/approve'
                ? { ...session, state: 'completed', approvedAmountMinor: 125000 }
                : session,
            device,
        }));
        expect(buttons().some(el => el.textContent.includes('Одобрить оплату'))).toBe(false);
        await wrapper.get('.payment-test-actions button').trigger('click');
        await flushPromises();
        expect(orderStore.paidOrder).toHaveBeenCalledWith(91, 1250);
        expect(homeLink()).not.toBeNull();
        expect(buttons()).toHaveLength(1);
        expect(paymentStore.phase).toBe('completed');
        await new DOMWrapper(homeLink()).trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('home');
        expect(paymentStore.phase).toBe('idle');
    });

    it('allows only support while confirming an approved payment', async () => {
        await openOrder();
        orderStore.paidOrder.mockImplementation(() => new Promise(() => {}));
        await updateSession('card-payment', { state: 'completed', approvedAmountMinor: 125000 });
        expect(wrapper.text()).toContain('Оплата получена');
        expect(homeLink()).toBeNull();
        expect(buttons()).toHaveLength(1);
    });

    it('removes unsafe actions when a payment needs operator attention', async () => {
        await openOrder();
        await updateSession('card-payment', { state: 'attention_required' });
        expect(wrapper.text()).toContain('Требуется помощь оператора');
        expect(homeLink()).toBeNull();
        expect(buttons()).toHaveLength(1);
    });

    it('hides cash cancellation once money has been accepted', async () => {
        session.state = 'accepting';
        await openOrder({ payment_method: 'cash' });
        expect(button('Отменить и начать заново').exists()).toBe(true);
        expect(button('Отменить и начать заново').classes()).toContain('--white');
        expect(button('Отменить и начать заново').find('svg').exists()).toBe(false);
        await updateSession('cash-payment', { acceptedAmountMinor: 10000, remainingAmountMinor: 115000 });
        expect(buttons()).toHaveLength(1);
        expect(homeLink()).toBeNull();
    });

    it('resumes a partial cash payment from an inline payment tile', async () => {
        session = { ...session, state: 'partial_payment', acceptedAmountMinor: 10000 };
        await openOrder({ payment_method: 'cash' });
        expect(button('Зачислить на баланс').exists()).toBe(true);
        expect(wrapper.findAll('.order-payment-actions button')).toHaveLength(2);
        expect(wrapper.findAll('.order-payment-actions button').every(tile => tile.classes().includes('--tile'))).toBe(true);
        expect(buttons()).toHaveLength(1);
        expect(button('Продолжить оплату').element.closest('main')).not.toBeNull();
        expect(button('Зачислить на баланс').element.closest('main')).not.toBeNull();
        expect(button('Зачислить на баланс').get('use').element.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('#wallet');
        expect(button('Продолжить оплату').get('use').element.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('#session');
        localApi.mockImplementation(async () => ({ session: { ...session, state: 'accepting' } }));
        await button('Продолжить оплату').trigger('click');
        await flushPromises();
        expect(localApi).toHaveBeenCalledWith('/api/cash/resume', expect.objectContaining({
            data: { sessionId: 'session-91' },
        }));
        expect(buttons()).toHaveLength(1);
    });

    it('credits a partial payment and replaces controls with home', async () => {
        session = { ...session, state: 'partial_payment', acceptedAmountMinor: 10000 };
        await openOrder({ payment_method: 'cash' });
        localApi.mockImplementation(async url => {
            session = { ...session, state: url.endsWith('/confirm') ? 'balance_credit_ready' : 'balance_credit_required' };
            return { session };
        });
        await button('Зачислить на баланс').trigger('click');
        await flushPromises();
        expect(creditCashToBalance).toHaveBeenCalledWith(expect.objectContaining({ orderId: 91 }));
        expect(wrapper.text()).toContain('Заказ отменён');
        expect(homeLink()).not.toBeNull();
        expect(buttons()).toHaveLength(1);
        expect(wrapper.find('.order-payment-actions').exists()).toBe(false);
    });

    it('keeps both tiles disabled while resuming payment', async () => {
        session = { ...session, state: 'partial_payment', acceptedAmountMinor: 10000 };
        await openOrder({ payment_method: 'cash' });
        localApi.mockImplementation(() => new Promise(() => {}));
        await button('Продолжить оплату').trigger('click');
        expect(button('Возобновляем…').element.disabled).toBe(true);
        expect(button('Зачислить на баланс').element.disabled).toBe(true);
    });

    it('shows retry in the panel if balance credit fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        session = { ...session, state: 'balance_credit_required', acceptedAmountMinor: 10000 };
        creditCashToBalance.mockRejectedValue(new Error('Offline'));
        await openOrder({ payment_method: 'cash' });
        expect(button('Повторить зачисление').exists()).toBe(true);
        expect(homeLink()).toBeNull();
    });

    it('keeps virtual banknote controls in the main content', async () => {
        session.state = 'accepting';
        device.testMode = true;
        await openOrder({ payment_method: 'cash' });
        await wrapper.findAll('.cash-test-actions button')
            .find(button => button.text() === '500 ₽').trigger('click');
        expect(localApi).toHaveBeenCalledWith('/api/cash/mock/insert', expect.objectContaining({
            data: { amountMinor: 50000 },
        }));
        expect(wrapper.get('.cash-test-actions').text()).toContain('Внести остаток');
        expect(buttons().some(el => el.textContent.includes('Внести остаток'))).toBe(false);
    });
});
