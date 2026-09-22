import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProgramView from './ProgramView.vue';
import { usePropertyStore } from '@/stores/propertyStore.js';

let wrapper;
let propertyStore;
let router;
let pinia;
beforeEach(async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    HTMLDialogElement.prototype.showModal = vi.fn(function () { this.setAttribute('open', ''); });
    HTMLDialogElement.prototype.close = vi.fn(function () { this.removeAttribute('open'); });
    pinia = createPinia();
    propertyStore = usePropertyStore(pinia);
    propertyStore.property = {
        programs: [
            { id: 1, name: 'Стандарт', description: 'Базовая мойка для ежедневной чистоты', price: 300, duration: 5, options: [{ id: 1, name: 'Пена', description: 'Удаляет загрязнения', passes: 2 }] },
            { id: 2, name: 'Комплекс', price: 500, options: [{ id: 2, name: 'Воск', image: '/wax.svg' }] },
        ],
        is_dry_open: true,
        addons: [{ id: 1, name: 'Дополнительная услуга', price: 100 }],
    };
    router = createRouter({ history: createMemoryHistory(), routes: [
        { path: '/programs/:programId', component: ProgramView },
        { path: '/programs', component: { template: '<div>Программы</div>' } },
        { path: '/programs/:programId/preorder', component: { template: '<div>Предзаказ</div>' } },
    ] });
    await router.push('/programs/1');
    wrapper = mount(ProgramView, { attachTo: document.body, global: { plugins: [pinia, router] } });
});

afterEach(() => {
    wrapper?.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    delete HTMLDialogElement.prototype.showModal;
    delete HTMLDialogElement.prototype.close;
});

it('places the title above icon-only options and duration beside the price below', () => {
    const block = wrapper.get('.property-program-details');
    expect(block.get('.header h2').text()).toBe('Стандарт');
    expect(block.get('.header .program-card-description').text()).toBe('Базовая мойка для ежедневной чистоты');
    expect(block.find('.header .label').exists()).toBe(false);
    expect(block.get('.program-card-options').text()).toBe('');
    expect(block.findAll('.program-option')).toHaveLength(2);
    expect(block.findAll('.program-option.--included')).toHaveLength(1);
    expect(block.get('.footer .duration').text()).toContain('5 мин');
    expect(block.get('.footer .price').text()).toContain('300');
});

it('redirects a directly opened program without additional services to preorder', async () => {
    wrapper.unmount();
    propertyStore.property.addons = [];
    await router.push('/programs/1');
    wrapper = mount(ProgramView, { attachTo: document.body, global: { plugins: [pinia, router] } });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/programs/1/preorder');
    expect(propertyStore.order.program_id).toBe(1);
});

it.each([undefined, null, '', '   \n '])('hides an empty API description (%s) even when options exist', async description => {
    propertyStore.program.description = description;
    await flushPromises();
    expect(wrapper.find('.program-card-description').exists()).toBe(false);
    expect(wrapper.findAll('.program-card-options .program-option')).toHaveLength(2);
});

it('opens descriptions only from help and closes the shared modal', async () => {
    await wrapper.get('.program-option').trigger('click');
    expect(wrapper.get('dialog').attributes('open')).toBeUndefined();
    await wrapper.get('.program-card-help').trigger('click');
    expect(wrapper.get('dialog').attributes('open')).toBeDefined();
    expect(wrapper.get('dialog').text()).toContain('Удаляет загрязнения');
    expect(wrapper.findAll('dialog .program-option-icon')).toHaveLength(2);
    expect(wrapper.findAll('dialog .program-option-explanation')).toHaveLength(2);
    await wrapper.get('.program-options-close').trigger('click');
    expect(wrapper.get('dialog').attributes('open')).toBeUndefined();
});
