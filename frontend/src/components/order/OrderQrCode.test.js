import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import OrderQrCode from './OrderQrCode.vue';
import { getQrImageUrl } from '@/functions/qrUrl.js';

describe('OrderQrCode', () => {
    it.each([
        [{}, 0],
        [{ changeAmount: 150 }, 1],
        [{ changeAmount: 150, cashbackAmount: 30 }, 2],
        [{ cashbackAmount: 30 }, 1],
        [{ balanceCreditAmount: 100 }, 1],
    ])('keeps the receipt caption below QR and amounts above it: %j', (amounts, count) => {
        const wrapper = mount(OrderQrCode, { props: {
            orderId: 91, orderUrl: 'https://app.example.com/order/91', ...amounts,
        } });
        expect(wrapper.get('.order-qr-description').text()).toBe('Чтобы открыть заказ и посмотреть чек, отсканируйте QR-код.');
        expect(wrapper.findAll('.order-qr-credit strong')).toHaveLength(count);
        const children = [...wrapper.element.children];
        const qrIndex = children.indexOf(wrapper.get('.order-qr-image').element);
        expect(children.indexOf(wrapper.get('.order-qr-description').element)).toBeGreaterThan(qrIndex);
        if (count) expect(children.indexOf(wrapper.get('.order-qr-credit').element)).toBeLessThan(qrIndex);
        else expect(wrapper.find('.order-qr-credit').exists()).toBe(false);
        wrapper.unmount();
    });

    it('renders a QR code that opens the current order', async () => {
        const orderUuid = '1c58304f-d1b2-45ff-8189-cd51a8207076';
        const wrapper = mount(OrderQrCode, {
            props: {
                orderId: 1524,
                orderUrl: `https://app.example.com/order/${orderUuid}`,
            },
        });
        expect(wrapper.text()).toContain('Заказ №1524');
        expect(wrapper.text()).toContain(
            'Чтобы открыть заказ и посмотреть чек, отсканируйте QR-код.'
        );
        expect(wrapper.get('img').attributes('src')).toBe(
            getQrImageUrl(`https://app.example.com/order/${orderUuid}`)
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
