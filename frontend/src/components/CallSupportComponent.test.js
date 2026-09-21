import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import CallSupportComponent from './CallSupportComponent.vue';
import { usePropertyStore } from '@/stores/propertyStore.js';
import { nextTick } from 'vue';

const mountComponent = props => mount(CallSupportComponent, {
    props,
    global: {
        plugins: [ createPinia() ],
    },
});

describe('CallSupportComponent', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it('shows the text by default', () => {
        const wrapper = mountComponent();

        expect(wrapper.get('button').text()).toBe('Вызов оператора');
        expect(wrapper.get('button').classes()).not.toContain('--icon-only');
    });

    it('shows only an accessible icon when showText is false', () => {
        const wrapper = mountComponent({ showText: false });
        const button = wrapper.get('button');

        expect(button.text()).toBe('');
        expect(button.find('svg').exists()).toBe(true);
        expect(button.classes()).toContain('--icon-only');
        expect(button.attributes('aria-label')).toBe('Вызов оператора');
        expect(button.attributes('title')).toBe('Вызов оператора');
    });

    it('replaces the icon with countdown digits and restores it when finished', async () => {
        const wrapper = mountComponent({ showText: false });
        const store = usePropertyStore(wrapper.vm.$pinia);
        store.supportState = 'sent';
        store.secondsLeft = 9;
        await nextTick();
        const button = wrapper.get('button');
        expect(button.text()).toBe('9');
        expect(button.find('svg').exists()).toBe(false);
        expect(button.element.disabled).toBe(true);
        expect(button.attributes('aria-label')).toContain('осталось 9');
        store.secondsLeft = 8;
        await nextTick();
        expect(button.text()).toBe('8');
        store.secondsLeft = 0;
        store.supportState = 'idle';
        await nextTick();
        expect(button.text()).toBe('');
        expect(button.find('svg').exists()).toBe(true);
        expect(button.element.disabled).toBe(false);
        wrapper.unmount();
    });

    it('keeps the icon and full countdown label when showText is true', async () => {
        const wrapper = mountComponent({ showText: true });
        const store = usePropertyStore(wrapper.vm.$pinia);
        store.supportState = 'sent';
        store.secondsLeft = 9;
        await nextTick();
        expect(wrapper.get('button').text()).toBe('Оператор вызван 9');
        expect(wrapper.find('svg').exists()).toBe(true);
        wrapper.unmount();
    });
});
