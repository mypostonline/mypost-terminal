import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomeView from './HomeView.vue';
import { usePropertyStore } from '@/stores/propertyStore.js';

let wrapper;
let propertyStore;
let router;

beforeEach(async () => {
    const pinia = createPinia();
    propertyStore = usePropertyStore(pinia);
    propertyStore.post = { id: 1, status: 'online' };
    propertyStore.isInitialized = true;
    propertyStore.isOnline = true;
    propertyStore.isNetwork = true;
    vi.spyOn(propertyStore, 'callSupport').mockResolvedValue();
    router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: HomeView },
            { path: '/programs', component: { template: '<div>Программы</div>' } },
        ],
    });
    await router.push('/');
    wrapper = mount(HomeView, {
        attachTo: document.body,
        global: { plugins: [pinia, router], stubs: { BannersComponent: true } },
    });
});

afterEach(() => {
    wrapper?.unmount();
    document.body.replaceChildren();
});

describe('HomeView inline actions', () => {
    it('shows Start and the labeled support button beside the post status, without a fixed panel or Back', async () => {
        const actions = wrapper.get('.post .post-actions');
        expect(actions.get('a').text()).toBe('Начать');
        expect(actions.get('a').classes()).not.toContain('--green');
        expect(actions.get('button').text()).toBe('Вызов оператора');
        expect(document.querySelector('.fixed-actions')).toBeNull();
        expect(document.querySelector('.fixed-actions-spacer')).toBeNull();
        expect(wrapper.find('[aria-label="Назад"]').exists()).toBe(false);
        await actions.get('a').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/programs');
    });

    it('still calls support from the main content', async () => {
        await wrapper.get('.post-actions button').trigger('click');
        expect(propertyStore.callSupport).toHaveBeenCalledOnce();
    });

    it('replaces Start with an unavailable message while keeping support', async () => {
        propertyStore.post.status = 'offline';
        await flushPromises();
        expect(wrapper.find('.post-actions a').exists()).toBe(false);
        expect(wrapper.get('.post-actions .post-unavailable').text()).toBe('Пост временно недоступен');
        expect(wrapper.get('.post-actions button').text()).toBe('Вызов оператора');
    });

    it('hides actions when the terminal loses its connection', async () => {
        propertyStore.isNetwork = false;
        await flushPromises();
        expect(wrapper.find('.post-actions').exists()).toBe(false);
        expect(wrapper.text()).toContain('Отсутствует интернет-соединение');
        expect(document.querySelector('.fixed-actions')).toBeNull();
    });
});
