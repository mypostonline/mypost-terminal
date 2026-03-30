<script setup>
import { computed } from "vue";

const props = defineProps({
    href: String,
    fill: String,
    stroke: String,
});

const classes = computed(() => {
    return {
        ['fill-' + props.fill]: props.fill,
        ['stroke-' + props.stroke]: props.stroke,
    }
})
</script>

<template>
    <svg class="__svg" :class="classes">
        <use v-bind="{'xlink:href' : href}"></use>
    </svg>
</template>
