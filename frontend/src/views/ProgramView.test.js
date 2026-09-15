import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProgramView from './ProgramView.vue';
import { usePropertyStore } from '@/stores/propertyStore.js';

let wrapper;
beforeEach(async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    HTMLDialogElement.prototype.showModal = vi.fn(function () { this.setAttribute('open', ''); });
    HTMLDialogElement.prototype.close = vi.fn(function () { this.removeAttribute('open'); });
    const pinia = createPinia();
    usePropertyStore(pinia).property = {
        programs: [
            { id: 1, name: 'Стандарт', description: 'Базовая мойка для ежедневной чистоты', price: 300, duration: 5, options: [{ id: 1, name: 'Пена', description: 'Удаляет загрязнения', passes: 2 }] },
            { id: 2, name: 'Комплекс', price: 500, options: [{ id: 2, name: 'Воск', image: '/wax.svg' }] },
        ],
        addons: [],
    };
    const router = createRouter({ history: createMemoryHistory(), routes: [
        { path: '/programs/:programId', component: ProgramView },
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
