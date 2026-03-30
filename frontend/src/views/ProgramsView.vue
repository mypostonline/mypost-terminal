<script setup>
import { storeToRefs } from "pinia";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { getPrice, wordEndPasses } from "@/functions/helpers.js";
import { useRouter } from "vue-router";
import CallSupportComponent from "@/components/CallSupportComponent.vue";

const router = useRouter();

const propertyStore = usePropertyStore();
const { isOnline, isNetwork, property, post } = storeToRefs(propertyStore);
</script>

<template>

    <main>

        <div v-if="property?.programs?.length">
            <div class="property-programs">
                <div v-for="(program, index) in property.programs" :key="index" class="program card_background">
                    <div class="content">
                        <div class="header">
                            <div class="label">Опции {{ program.options?.length }}</div>
                            <div class="duration">{{ program.duration + ' мин' }}</div>
                        </div>
                        <div v-if="program.options?.length" class="items">
                            <div v-for="option in program.options" class="item">
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
                    <router-link :to="`/programs/${program.id}`"/>
                </div>
            </div>
            <div class="mt-6">
                <router-link to="/" class="__button">Назад</router-link>
            </div>
            <div class="mt-6 text-center">
                <call-support-component />
            </div>
        </div>

    </main>

</template>

<style scoped>

</style>