import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PreorderView from './PreorderView.vue';
import { usePropertyStore } from '@/stores/propertyStore.js';
import { useOrderStore } from '@/stores/orderStore.js';
import { usePaymentCapabilitiesStore } from '@/stores/paymentCapabilitiesStore.js';

let wrapper;
let propertyStore;
let orderStore;

beforeEach(async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const pinia = createPinia();
    propertyStore = usePropertyStore(pinia);
    propertyStore.property = { id: 1, programs: [{ id: 1, name: 'Мойка', price: 1250 }], addons: [] };
    propertyStore.post = { id: 1, status: 'online', payment_methods: ['card', 'cash'] };
    propertyStore.setProgram(1);
    const capabilities = usePaymentCapabilitiesStore(pinia);
    capabilities.status = {
        cardTerminal: { available: true },
        billAcceptor: { available: true, state: 'ready' },
    };
    vi.spyOn(capabilities, 'refresh').mockResolvedValue(capabilities.status);
    orderStore = useOrderStore(pinia);
    vi.spyOn(orderStore, 'createOrder').mockImplementation(async data => ({ ...data, id: 91 }));
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/programs/:programId/preorder', component: PreorderView },
            { path: '/programs/:programId', component: { template: '<div>Программа</div>' } },
            { path: '/order/:orderId', component: { template: '<div>Заказ</div>' } },
        ],
    });
    await router.push('/programs/1/preorder');
    wrapper = mount(PreorderView, { attachTo: document.body, global: { plugins: [pinia, router] } });
    await flushPromises();
});

afterEach(() => {
    wrapper?.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

describe('Preorder payment tiles', () => {
    it('creates an SBP order when enabled by the post API, without duplicate tiles', async () => {
        propertyStore.post.payment_methods = ['card', 'sbp', 'cash'];
        await flushPromises();
        const tiles = wrapper.findAll('.payment-methods button');
        expect(tiles).toHaveLength(3);
        expect(tiles[1].element.disabled).toBe(false);
        await tiles[1].trigger('click');
        await flushPromises();
        expect(orderStore.createOrder).toHaveBeenCalledWith(expect.objectContaining({ payment_method: 'sbp' }), expect.any(Object));
    });

    it('disables configured SBP when the post is offline', async () => {
        propertyStore.post.payment_methods = ['sbp'];
        propertyStore.post.status = 'offline';
        await flushPromises();
        expect(wrapper.get('.payment-methods button').element.disabled).toBe(true);
    });
    it('keeps the total and bonuses outside the scrollable content', () => {
        expect(wrapper.get('.order-final-list .content').text()).not.toContain('Итого:');
        expect(wrapper.get('.order-final-list .footer').text()).toContain('Итого:');
        expect(wrapper.get('.order-final-list .footer').text()).toContain('Начислено бонусов*');
    });
    it('shows three icon choices in the main content, with SBP disabled', async () => {
        const tiles = wrapper.findAll('.payment-methods button');
        expect(tiles).toHaveLength(3);
        expect(tiles.every(tile => tile.classes().includes('--tile') && !tile.classes().includes('--green'))).toBe(true);
        expect(tiles[1].text()).toBe('По СБП');
        expect(tiles.map(tile => tile.get('use').element.getAttributeNS('http://www.w3.org/1999/xlink', 'href'))).toEqual([
            '#nfc_green', '#sbp', '#cash',
        ]);
        expect(tiles[1].element.disabled).toBe(true);
        expect(wrapper.find('#payment-sbp-status').exists()).toBe(false);
        expect(tiles[1].attributes('aria-describedby')).toBeUndefined();
        expect(wrapper.text()).not.toContain('Скоро');
        await tiles[1].trigger('click');
        expect(orderStore.createOrder).not.toHaveBeenCalled();
        expect(document.querySelectorAll('.fixed-actions .--tile')).toHaveLength(0);
    });

    it.each([['card', 'vendotek'], ['cash', 'cash']])('still creates an order for %s', async (code, paymentMethod) => {
        await wrapper.findAll('.payment-methods button')[code === 'card' ? 0 : 2].trigger('click');
        await flushPromises();
        expect(orderStore.createOrder).toHaveBeenCalledWith(expect.objectContaining({
            payment_method: paymentMethod, total_amount: 1250,
        }), expect.any(Object));
    });

    it('keeps SBP between card and cash regardless of configuration order', async () => {
        propertyStore.post.payment_methods = ['cash', 'card'];
        await flushPromises();
        expect(wrapper.findAll('.payment-methods button').map(tile => tile.text())).toEqual([
            'Картой', 'По СБП', 'Наличными',
        ]);
    });

    it('keeps SBP without a status label when the post is unavailable', async () => {
        propertyStore.post.status = 'offline';
        await flushPromises();
        expect(wrapper.findAll('.payment-methods button').every(tile => tile.element.disabled)).toBe(true);
        expect(wrapper.find('#payment-sbp-status').exists()).toBe(false);
        expect(wrapper.text()).toContain('Оплата на этом терминале временно недоступна');
    });
});
