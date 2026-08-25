import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import OrderQrCode from './OrderQrCode.vue';

describe('OrderQrCode', () => {
    it('renders a QR code that opens the current order', async () => {
        const orderUuid = '1c58304f-d1b2-45ff-8189-cd51a8207076';
        const wrapper = mount(OrderQrCode, {
            props: {
                orderId: 1524,
                orderUrl: `https://app.example.com/order/${orderUuid}`,
                description: 'Чтобы зачислить сдачу, отсканируйте QR-код.',
            },
        });
        expect(wrapper.text()).toContain('Заказ №1524');
        expect(wrapper.text()).toContain(
            'Чтобы зачислить сдачу, отсканируйте QR-код.'
        );
        expect(wrapper.get('img').attributes('src')).toBe(
            'http://localhost:3000/qr/svg?' +
                'text=https%3A%2F%2Fapp.example.com%2Forder%2F' +
                orderUuid
        );

        await wrapper.get('img').trigger('load');

        expect(wrapper.get('.order-qr-image').classes()).toContain('--loaded');
        expect(wrapper.get('.order-qr-image').classes()).toContain(
            'qr-code-frame'
        );
    });

    it('shows an error when the backend QR image cannot be loaded', async () => {
        const wrapper = mount(OrderQrCode, {
            props: {
                orderId: 1524,
                orderUrl: 'https://app.example.com/order/1524',
            },
        });

        await wrapper.get('img').trigger('error');

        expect(wrapper.text()).toContain('Не удалось показать QR-код заказа');
    });
});
