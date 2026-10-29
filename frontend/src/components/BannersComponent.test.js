import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BannersComponent from './BannersComponent.vue';

vi.mock('@splidejs/vue-splide', () => ({
    Splide: { template: '<div><slot /></div>' },
    SplideSlide: { template: '<div class="splide-slide"><slot /></div>' },
}));

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('BannersComponent local slides', () => {
    it('loads local videos and applies their own display interval', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [{
                type: 'video',
                file: 'offer.mp4',
                poster: 'offer.jpg',
                intervalMs: 21500,
                label: 'Предложение',
            }],
        }));

        const wrapper = mount(BannersComponent);
        await flushPromises();

        const video = wrapper.get('video[src="/assets/local/offer.mp4"]');
        expect(video.attributes('poster')).toBe('/assets/local/offer.jpg');
        expect(video.attributes('aria-label')).toBe('Предложение');
        expect(video.element.closest('.splide-slide').getAttribute('data-splide-interval')).toBe('21500');
        expect(wrapper.findAll('.splide-slide')).toHaveLength(1);
        expect(wrapper.find('img').exists()).toBe(false);
        wrapper.unmount();
    });

    it('keeps the default slides when a terminal has no local manifest', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

        const wrapper = mount(BannersComponent);
        await flushPromises();

        expect(wrapper.findAll('.splide-slide')).toHaveLength(6);
        wrapper.unmount();
    });
});
