<script setup>
import { onBeforeMount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { getNumber, getPrice, wordEndPasses } from "@/functions/helpers.js";
import CallSupportComponent from "@/components/CallSupportComponent.vue";

const route = useRoute();
const router = useRouter();

const propertyStore = usePropertyStore();
const { property, program, order } = storeToRefs(propertyStore);

onBeforeMount(() => {
    propertyStore.resetAddons();
    if (!propertyStore.setProgram(route.params.programId)) {
        router.replace('/programs');
    }
});

const isExcludedAddon = (addon) => {
    if (program.value?.excluded_addons?.length) {
        return program.value.excluded_addons.findIndex(item => item.id === addon.id) !== -1;
    }
    return false;
}

</script>

<template>

    <main v-if="program.id">

        <div class="property-program-details card_background">
            <div class="header">
                <div class="label">Опции {{ program.options?.length }}</div>
                <div class="duration">{{ program.duration + ' мин' }}</div>
            </div>
            <div v-if="program.options?.length" class="items">
                <div
                    v-for="option in program.options"
                    :key="option.id"
                    class="item"
                >
                    <div class="image">
                        <img v-if="option.image" :src="option.image" alt="">
                    </div>
                    <div class="name">
                        <span>{{ option.name }}</span>
                        <span v-if="option.passes"> ({{ wordEndPasses(option.passes) }})</span>
                    </div>
                </div>
            </div>
            <div class="footer">
                <div class="name">{{ program.name }}</div>
                <div class="price">{{ getPrice(program.price) }}</div>
            </div>
        </div>

        <template v-if="property?.is_dry_open && property?.addons?.length">
            <h2 class="font-semibold text-(--primary-color) mb-2 mt-6">Выбор дополнительных программ</h2>
            <div class="property-addons addons">
                <button
                    v-for="addon in property.addons"
                    :key="addon.id"
                    :class="{'--active': addon.isActive}"
                    class="addon card_background"
                    @click="propertyStore.selectAddon(addon)"
                    :disabled="isExcludedAddon(addon)"
                >
                    <span class="image">
                        <img v-if="addon.image" :src="addon.image" alt="">
                    </span>
                    <span class="content">
                        <span class="name">{{ addon.name }}</span>
                        <span class="details">
                            <span class="price">
                                <svg class="__svg" style="fill: #ffffff;">
                                    <use xlink:href="#cash"></use>
                                </svg>
                                {{ getPrice(addon.price) }}
                            </span>
                            <span class="price">
                                <svg class="__svg" style="fill: #ffffff;">
                                    <use xlink:href="#clock"></use>
                                </svg>
                                {{ getNumber(addon.duration) + ' мин' }}
                            </span>
                        </span>
                    </span>
                </button>
            </div>
        </template>

        <div class="mt-6" style="display: grid; grid-template-columns: 1fr 2fr 1fr; align-items: center;">
            <div>
                <router-link to="/programs" class="__button --small">
                    <svg class="__svg" style="fill: var(--primary-color); transform: rotate(180deg);">
                        <use xlink:href="#arrow"></use>
                    </svg>
                </router-link>
            </div>
            <div class=" text-center">
                <router-link :to="`/programs/${program.id}/preorder`" class="__button --green">
                    Итого {{ getPrice(order.total_amount) }}
                </router-link>
            </div>
            <div class="flex justify-end">
                <call-support-component :show-text="false" />
            </div>
        </div>

        <!--
        <div class="mt-6 text-center">
            <call-support-component />
        </div>
        -->

    </main>

</template>

<style scoped>

</style>
