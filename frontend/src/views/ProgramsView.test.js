import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProgramsView from './ProgramsView.vue';
import { usePropertyStore } from '@/stores/propertyStore.js';

let wrapper;
let propertyStore;
let router;
const cards = () => wrapper.findAll('.program-card');
const labels = card => card.findAll('.program-option').map(option => option.attributes('aria-label').split(':')[0]);

beforeEach(async () => {
    // jsdom does not implement native dialog methods.
    HTMLDialogElement.prototype.showModal = vi.fn(function () { this.setAttribute('open', ''); });
    HTMLDialogElement.prototype.close = vi.fn(function () { this.removeAttribute('open'); });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const pinia = createPinia();
    propertyStore = usePropertyStore(pinia);
    propertyStore.property = {
        is_dry_open: true,
        programs: [
            { id: 1, name: 'Стандарт', description: 'Базовая мойка', duration: 5, price: 300,
                options: [{ id: 1, name: 'Вода' }, { id: 2, name: 'Пена', image: '/foam.svg', description: 'Удаляет загрязнения с кузова' }] },
            { id: 2, name: 'Комплекс', description: 'Полный уход', duration: 12, price: 800,
                options: [{ id: '1', name: 'Вода' }, { id: 3, name: 'Воск', passes: 2 }], included_addons: [{ id: 1 }] },
        ],
    };
    router = createRouter({ history: createMemoryHistory(), routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/programs', component: ProgramsView },
        { path: '/programs/:programId', component: { template: '<div>Программа</div>' } },
    ] });
    await router.push('/programs');
    wrapper = mount(ProgramsView, { attachTo: document.body, global: { plugins: [pinia, router] } });
});

afterEach(() => {
    wrapper?.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete HTMLDialogElement.prototype.showModal;
    delete HTMLDialogElement.prototype.close;
});

describe('program comparison cards', () => {
    it('shows names, descriptions, prices and duration without the old image background', () => {
        expect(cards()).toHaveLength(2);
        expect(cards()[0].get('.program-card-name').text()).toBe('Стандарт');
        expect(cards()[0].get('.program-card-description').text()).toBe('Базовая мойка');
        expect(cards()[0].get('.program-card-price').text()).toContain('300');
        expect(cards()[0].get('.program-card-duration').text()).toBe('5 мин');
        expect(wrapper.find('.card_background').exists()).toBe(false);
    });

    it('uses the same deduplicated option order and marks only included options', () => {
        expect(labels(cards()[0])).toEqual(['Вода', 'Пена', 'Воск']);
        expect(labels(cards()[1]).map(label => label.split(' (')[0])).toEqual(['Вода', 'Пена', 'Воск']);
        expect(cards()[0].findAll('.program-option.--included').map(el => el.attributes('aria-label').split(':')[0])).toEqual(['Вода', 'Пена']);
        expect(cards()[1].findAll('.program-option').map(el => el.classes().includes('--included'))).toEqual([true, false, true]);
        expect(cards()[1].findAll('.program-option')[1].attributes('aria-label')).toContain('не входит');
        expect(cards()[1].findAll('.program-option')[2].attributes('aria-label')).toContain('2');
        expect(cards()[0].find('.program-option-icon svg').exists()).toBe(true);
    });

    it('preserves navigation and the fixed side controls', async () => {
        expect(document.querySelectorAll('.fixed-actions')).toHaveLength(1);
        expect(document.querySelector('[aria-label="Назад"]')).not.toBeNull();
        expect(document.querySelector('[aria-label="Вызов оператора"]')).not.toBeNull();
        await cards()[1].get('.program-card-link').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/programs/2');
    });

    it('keeps unavailable programs hidden without changing the option catalog', async () => {
        propertyStore.property.is_dry_open = false;
        await flushPromises();
        expect(cards()).toHaveLength(1);
        expect(labels(cards()[0])).toEqual(['Вода', 'Пена', 'Воск']);
    });

    it('handles missing descriptions and empty option lists', async () => {
        propertyStore.property.programs = [{ id: 3, name: 'Программа', price: 100 }];
        await flushPromises();
        expect(cards()).toHaveLength(1);
        expect(wrapper.find('.program-card-options').exists()).toBe(false);
        expect(wrapper.find('.program-card-description').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('undefined');
    });

    it.each([undefined, null, '', '   \n '])('hides an empty API description (%s) even when options exist', async description => {
        propertyStore.property.programs[0].description = description;
        await flushPromises();
        expect(cards()[0].find('.program-card-description').exists()).toBe(false);
        expect(cards()[0].findAll('.program-option')).not.toHaveLength(0);
    });

    it('shows all option descriptions from the help button without navigating', async () => {
        expect(wrapper.find('.program-option-label').exists()).toBe(false);
        const help = cards()[1].get('.program-card-help');
        await help.trigger('click');
        const descriptions = wrapper.get('.program-option-descriptions');
        expect(descriptions.findAll('li')).toHaveLength(3);
        expect(descriptions.text()).toContain('Воск (2');
        expect(descriptions.text()).toContain('Удаляет загрязнения с кузова');
        expect(descriptions.text()).toContain('Входит в программу');
        expect(descriptions.text()).toContain('Не входит в программу');
        expect(help.attributes('aria-expanded')).toBe('true');
        expect(wrapper.get('dialog').attributes('open')).toBeDefined();
        expect(descriptions.findAll('.program-option-icon')).toHaveLength(3);
        expect(descriptions.findAll('.program-option-explanation')).toHaveLength(3);
        expect(router.currentRoute.value.path).toBe('/programs');
        await wrapper.get('.program-options-close').trigger('click');
        expect(wrapper.find('.program-option-descriptions').exists()).toBe(false);
    });

    it('closes descriptions on backdrop click or Escape cancellation', async () => {
        const help = cards()[0].get('.program-card-help');
        await help.trigger('click');
        await wrapper.get('dialog').trigger('cancel');
        await flushPromises();
        expect(wrapper.find('.program-option-descriptions').exists()).toBe(false);
        await help.trigger('click');
        await wrapper.get('dialog').trigger('click');
        await flushPromises();
        expect(wrapper.find('.program-option-descriptions').exists()).toBe(false);
    });

    it('does not show descriptions when an option icon is clicked', async () => {
        expect(wrapper.find('.program-card-options button').exists()).toBe(false);
        await cards()[0].get('.program-option').trigger('click');
        expect(wrapper.find('.program-option-descriptions').exists()).toBe(false);
        expect(wrapper.find('.program-option-popover').exists()).toBe(false);
        expect(router.currentRoute.value.path).toBe('/programs');
    });

    it('opens descriptions only for the selected card', async () => {
        await cards()[0].get('.program-card-help').trigger('click');
        await cards()[1].get('.program-card-help').trigger('click');
        expect(wrapper.findAll('.program-option-descriptions')).toHaveLength(1);
        expect(cards()[0].get('.program-card-help').attributes('aria-expanded')).toBe('false');
        expect(cards()[1].get('.program-card-help').attributes('aria-expanded')).toBe('true');
    });
});
