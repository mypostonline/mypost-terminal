import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import OrderSummaryComponent from './OrderSummaryComponent.vue';

describe('OrderSummaryComponent', () => {
    it('keeps totals and bonuses outside the scrollable item list', () => {
        const wrapper = mount(OrderSummaryComponent, { props: { order: {
            total_amount: 1500, cashback_amount: 50,
            items: [
                { id: 1, program_id: 1, name: 'Мойка', price: 500 },
                ...Array.from({ length: 20 }, (_, i) => ({ id: i + 2, addon_id: i + 1, name: `Услуга ${i + 1}`, price: 50 })),
            ],
        } } });
        const content = wrapper.get('.content');
        expect(content.findAll('.item')).toHaveLength(21);
        expect(content.text()).not.toContain('Итого:');
        expect(content.attributes('tabindex')).toBe('0');
        expect(wrapper.get('.footer').text()).toContain('Итого:');
        expect(wrapper.get('.footer').text()).toContain('Начислено бонусов*');
        expect(wrapper.get('.footer').findAll('.item')).toHaveLength(2);
        wrapper.unmount();
    });
});
