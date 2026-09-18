<script setup>
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { getPrice, wordEndPasses } from "@/functions/helpers.js";
import CallSupportComponent from "@/components/CallSupportComponent.vue";
import FixedActions from "@/components/FixedActions.vue";
import ProgramOptionsDialog from "@/components/ProgramOptionsDialog.vue";

const propertyStore = usePropertyStore();
const { property } = storeToRefs(propertyStore);

const expandedProgramId = ref(null);
const toggleDescriptions = programId => {
    expandedProgramId.value = programId;
};

const isProgramAvailable = (program) => {
    return !program?.included_addons?.length || property.value?.is_dry_open;
};

const optionKey = option => option.id != null
    ? String(option.id)
    : `name:${String(option.name || '').trim().toLowerCase()}`;

// One catalog for every card, including options from temporarily unavailable programs.
const allOptions = computed(() => {
    const options = new Map();
    for (const program of property.value?.programs || []) {
        for (const option of program.options || []) {
            const key = optionKey(option);
            const existing = options.get(key);
            options.set(key, {
                key,
                name: existing?.name || option.name || 'Опция',
                image: existing?.image || option.image,
                description: existing?.description || option.description,
            });
        }
    }
    return [...options.values()];
});

const programCards = computed(() => (property.value?.programs || [])
    .filter(isProgramAvailable)
    .map(program => {
        const included = new Map((program.options || []).map(option => [optionKey(option), option]));
        return {
            ...program,
            description: typeof program.description === 'string' ? program.description.trim() : '',
            comparisonOptions: allOptions.value.map(option => {
                const selected = included.get(option.key);
                const passes = selected?.passes ? ` (${wordEndPasses(selected.passes)})` : '';
                return {
                    ...option,
                    included: Boolean(selected),
                    description: selected?.description || option.description,
                    label: `${option.name}${passes}`,
                };
            }),
        };
    }));
const selectedProgram = computed(() => programCards.value.find(program => program.id === expandedProgramId.value));
</script>

<template>
    <main class="programs-view">
        <div v-if="programCards.length" class="program-cards">
            <article
                v-for="(program, index) in programCards"
                :key="program.id"
                class="program-card program-card-surface"
                :style="{ '--gradient-opacity': 0.22 + 0.53 * (index / Math.max(1, programCards.length - 1)) ** 1.5 }"
            >
                <router-link
                    :to="`/programs/${program.id}`"
                    class="program-card-link"
                    :aria-label="`Выбрать программу ${program.name}`"
                />
                <div class="program-card-summary">
                    <div class="program-card-heading">
                        <h2 class="program-card-name">{{ program.name }}</h2>
                        <button
                            v-if="program.comparisonOptions.length"
                            type="button"
                            class="program-card-help"
                            :aria-label="`Описания опций программы ${program.name}`"
                            :aria-expanded="expandedProgramId === program.id"
                            aria-controls="program-options-dialog"
                            aria-haspopup="dialog"
                            @click="toggleDescriptions(program.id)"
                        >?</button>
                    </div>
                    <p v-if="program.description" class="program-card-description">{{ program.description }}</p>
                </div>
                <div v-if="program.comparisonOptions.length" class="program-card-option-block">
                    <ul class="program-card-options" aria-label="Состав программы">
                        <li v-for="option in program.comparisonOptions" :key="option.key">
                            <div
                                role="img"
                                class="program-option"
                                :class="{ '--included': option.included }"
                                :aria-label="`${option.label}: ${option.included ? 'входит в программу' : 'не входит в программу'}`"
                            >
                                <span class="program-option-icon" aria-hidden="true">
                                    <img v-if="option.image" :src="option.image" alt="">
                                    <svg v-else class="__svg"><use xlink:href="#receipt" /></svg>
                                </span>
                                <span v-if="option.included" class="program-option-check" aria-hidden="true">✓</span>
                            </div>
                        </li>
                    </ul>
                </div>
                <div class="program-card-footer">
                    <span v-if="program.duration != null" class="program-card-duration">
                        <svg class="__svg" aria-hidden="true"><use xlink:href="#clock" /></svg>
                        {{ program.duration }} мин
                    </span>
                    <span class="program-card-price">{{ getPrice(program.price) }}</span>
                </div>
            </article>
        </div>
        <p v-if="allOptions.length && programCards.length" class="program-options-hint">
            Зелёным отмечены опции, входящие в программу. Нажмите «?», чтобы увидеть все описания опций.
        </p>

        <ProgramOptionsDialog :program="selectedProgram" @close="expandedProgramId = null" />

        <fixed-actions label="Действия при выборе программы">
            <template #leading>
                <router-link to="/" class="__button" aria-label="Назад" title="Назад">
                    <svg class="__svg --back" aria-hidden="true">
                        <use xlink:href="#arrow"></use>
                    </svg>
                </router-link>
            </template>
            <template #trailing>
                <call-support-component :show-text="false" />
            </template>
        </fixed-actions>
    </main>
</template>

<style scoped>
.programs-view,
.program-card {
    position: relative;
    min-width: 0;
    overflow-wrap: anywhere;
}

.program-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: 1fr;
    gap: 0.85rem;
}

.program-card {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 0.85rem;
    text-decoration: none;
}

.program-card-link {
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
}

.program-card-link:focus-visible,
.program-card-help:focus-visible {
    outline: 3px solid var(--primary-color);
    outline-offset: 3px;
}

.program-card:active {
    border-color: var(--primary-color);
}

.program-card-summary {
    position: relative;
    z-index: 2;
    isolation: isolate;
    pointer-events: none;
    flex: 1;
    min-height: 10rem;
    margin: -0.85rem -0.85rem 0;
    padding: 0.85rem 0.85rem .85rem;
    overflow: hidden;
    border-radius: 0.85rem 0.85rem 0 0;
}

.program-card-name {
    min-width: 0;
    margin: 0;
    font-size: clamp(20px, 1.1rem, 40px);
    font-weight: 700;
    line-height: 1.15;
}

.program-card-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.3rem;
}

.program-card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.3rem;
    padding-top: 0.6rem;
    border-top: 1px solid rgb(158 172 212 / 30%);
}

.program-card-duration {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: clamp(12px, 0.8rem, 21px);
    font-weight: 600;
}

.program-card-price {
    margin-left: auto;
    font-size: clamp(18px, 0.95rem, 35px);
    font-weight: 700;
}

.program-options-hint {
    margin-top: 0.6rem;
    font-size: clamp(12px, 0.55rem, 20px);
    line-height: 1.4;
    font-weight: 500;
}

</style>
