import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import CallSupportComponent from './CallSupportComponent.vue';

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
});
