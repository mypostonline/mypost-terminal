<script setup>
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { useRoute } from "vue-router";
import { useAppStore } from "@/stores/appStore.js";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { Splide, SplideSlide } from "@splidejs/vue-splide";
import '@splidejs/vue-splide/css';

const route = useRoute();

const appStore = useAppStore();
const { weather } = storeToRefs(appStore);

const propertyStore = usePropertyStore();
const { property } = storeToRefs(propertyStore);

const slides = computed(() => {
    const result = [];
    result.push({ image: '/assets/banners/1.png' });
    result.push({ image: '/assets/banners/2.png' });
    result.push({ image: '/assets/banners/3.png' });
    result.push({ image: '/assets/banners/4.png' });
    result.push({ image: '/assets/banners/5.png' });
    result.push({ image: '/assets/banners/6.png' });

    return result;
});

</script>

<template>

    <div v-if="slides.length > 0" class="banners">
        <Splide :options="{ type: 'loop', rewind: true, arrows: false, gap: 20, pagination: true, autoplay: true }">
            <SplideSlide v-for="slide in slides">
                <div class="slide">
                    <img :src="slide.image" alt="">
                </div>
            </SplideSlide>
        </Splide>
    </div>

</template>

<style scoped>

</style>