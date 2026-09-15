<script setup>
import { ref, watch } from 'vue';

const props = defineProps({ program: { type: Object, default: null } });
const emit = defineEmits(['close']);
const optionsDialog = ref(null);
const closeDescriptions = () => {
    optionsDialog.value?.close();
    emit('close');
};
watch(() => props.program, program => {
    if (program) optionsDialog.value?.showModal();
    else optionsDialog.value?.close();
}, { flush: 'post' });
</script>

<template>
        <dialog
            id="program-options-dialog"
            ref="optionsDialog"
            class="program-options-dialog"
            aria-labelledby="program-options-title"
            @cancel.prevent="closeDescriptions"
            @close="emit('close')"
            @click.self="closeDescriptions"
        >
            <div v-if="program" class="program-options-modal">
                <header class="program-options-modal-header">
                    <h2 id="program-options-title">{{ program.name }} — опции</h2>
                    <button type="button" class="program-options-close" aria-label="Закрыть" autofocus @click="closeDescriptions">×</button>
                </header>
                <ul class="program-option-descriptions" :aria-label="`Все опции программы ${program.name}`">
                    <li v-for="option in program.comparisonOptions" :key="option.key">
                        <div class="program-option" :class="{ '--included': option.included }" aria-hidden="true">
                            <span class="program-option-icon">
                                <img v-if="option.image" :src="option.image" alt="">
                                <svg v-else class="__svg"><use xlink:href="#receipt" /></svg>
                            </span>
                        </div>
                        <div class="program-option-explanation">
                            <strong>{{ option.label }}</strong>
                            <span v-if="option.description">{{ option.description }}</span>
                            <span class="program-option-status" :class="{ '--included': option.included }">
                                {{ option.included ? 'Входит в программу' : 'Не входит в программу' }}
                            </span>
                        </div>
                    </li>
                </ul>
            </div>
        </dialog>
</template>
