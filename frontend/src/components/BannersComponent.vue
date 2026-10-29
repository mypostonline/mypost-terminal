<script setup>
import { computed, onMounted, ref } from "vue";
import { Splide, SplideSlide } from "@splidejs/vue-splide";
import '@splidejs/vue-splide/css';

const defaultSlides = [
    { image: '/assets/banners/1.png' },
    { image: '/assets/banners/2.png' },
    { image: '/assets/banners/3.png' },
    { image: '/assets/banners/4.png' },
    { image: '/assets/banners/5.png' },
    { image: '/assets/banners/6.png' },
];
const localSlides = ref([]);
const slides = computed(() => localSlides.value.length > 0 ? localSlides.value : defaultSlides);

function localAssetUrl(file) {
    if (typeof file !== 'string' || !file || file === '.' || file === '..' || /[/\\]/.test(file)) {
        return null;
    }

    return `/assets/local/${encodeURIComponent(file)}`;
}

function toLocalSlide(entry) {
    const file = localAssetUrl(entry?.file);
    if (!file) return null;

    const intervalMs = Number(entry.intervalMs);
    const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? { intervalMs } : {};

    if (entry.type === 'image') return { image: file, ...interval };
    if (entry.type === 'video') {
        return {
            video: file,
            poster: localAssetUrl(entry.poster),
            label: entry.label || 'Локальный видеобаннер',
            ...interval,
        };
    }

    return null;
}

onMounted(async () => {
    try {
        const response = await fetch('/assets/local/manifest.json', { cache: 'no-store' });
        if (!response.ok) return;

        const entries = await response.json();
        if (Array.isArray(entries)) {
            localSlides.value = entries.map(toLocalSlide).filter(Boolean);
        }
    } catch {
        // A terminal without local banners uses the default slides.
    }
});

function onSlideActive(_splide, slide) {
    const video = slide.slide.querySelector('video');
    if (!video) return;

    video.currentTime = 0;
    video.play().catch(() => {});
}

function onSlideInactive(_splide, slide) {
    const video = slide.slide.querySelector('video');
    if (!video) return;

    video.pause();
    video.currentTime = 0;
}

</script>

<template>

    <div v-if="slides.length > 0" class="banners">
        <Splide
            :options="{ type: 'loop', rewind: true, arrows: false, gap: 20, pagination: true, autoplay: true }"
            @splide:active="onSlideActive"
            @splide:inactive="onSlideInactive"
        >
            <SplideSlide v-for="slide in slides" :key="slide.image || slide.video"
                         :data-splide-interval="slide.intervalMs">
                <div class="slide">
                    <video v-if="slide.video" :src="slide.video" :poster="slide.poster"
                           muted playsinline preload="metadata" :aria-label="slide.label"></video>
                    <img v-else :src="slide.image" alt="">
                </div>
            </SplideSlide>
        </Splide>
    </div>

</template>

<style scoped>

</style>
