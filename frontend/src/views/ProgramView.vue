<script setup>
import { computed, onBeforeMount, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { usePropertyStore } from "@/stores/propertyStore.js";
import { getNumber, getPrice, wordEndPasses } from "@/functions/helpers.js";
import CallSupportComponent from "@/components/CallSupportComponent.vue";
import FixedActions from "@/components/FixedActions.vue";
import ProgramOptionsDialog from "@/components/ProgramOptionsDialog.vue";

const route = useRoute();
const router = useRouter();

const propertyStore = usePropertyStore();
const { property, program, order } = storeToRefs(propertyStore);
const showOptions = ref(false);
const optionKey = option => option.id != null ? String(option.id) : `name:${String(option.name || '').trim().toLowerCase()}`;
const detailProgram = computed(() => {
    const catalog = new Map();
    for (const item of [...(property.value?.programs || []), program.value]) {
        for (const option of item.options || []) {
            const key = optionKey(option);
            const previous = catalog.get(key);
            catalog.set(key, { ...option, key, image: previous?.image || option.image, description: previous?.description || option.description });
        }
    }
    const included = new Map((program.value.options || []).map(option => [optionKey(option), option]));
    return {
        ...program.value,
        description: typeof program.value.description === 'string' ? program.value.description.trim() : '',
        comparisonOptions: [...catalog.values()].map(option => {
            const selected = included.get(option.key);
            return {
                ...option,
                included: Boolean(selected),
                description: selected?.description || option.description,
                label: `${option.name}${selected?.passes ? ` (${wordEndPasses(selected.passes)})` : ''}`,
            };
        }),
    };
});

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

    <main v-if="program.id" class="program-view">

        <div class="property-program-details program-card-surface">
            <div class="header">
                <div class="program-details-heading">
                    <h2 class="name">{{ program.name }}</h2>
                    <p v-if="detailProgram.description" class="program-card-description">{{ detailProgram.description }}</p>
                </div>
                <button v-if="detailProgram.comparisonOptions.length" type="button" class="program-card-help"
                    :aria-label="`Описания опций программы ${program.name}`" :aria-expanded="showOptions"
                    aria-haspopup="dialog" aria-controls="program-options-dialog" @click="showOptions = true">?</button>
            </div>
            <ul v-if="detailProgram.comparisonOptions.length" class="program-card-options" aria-label="Состав программы">
                <li v-for="option in detailProgram.comparisonOptions" :key="option.key">
                    <div class="program-option" :class="{ '--included': option.included }" role="img"
                        :aria-label="`${option.label}: ${option.included ? 'входит в программу' : 'не входит в программу'}`">
                        <span class="program-option-icon" aria-hidden="true">
                            <img v-if="option.image" :src="option.image" alt="">
                            <svg v-else class="__svg"><use xlink:href="#receipt" /></svg>
                        </span>
                    </div>
                </li>
            </ul>
            <div class="footer">
                <div v-if="program.duration != null" class="duration">
                    <svg class="__svg program-detail-icon" aria-hidden="true"><use xlink:href="#clock" /></svg>
                    {{ program.duration }} мин
                </div>
                <div class="price">{{ getPrice(program.price) }}</div>
            </div>
        </div>
        <ProgramOptionsDialog :program="showOptions ? detailProgram : null" @close="showOptions = false" />

        <template v-if="property?.is_dry_open && property?.addons?.length">
            <h2 class="font-semibold text-(--primary-color) mb-2 mt-6">Выбор дополнительных программ</h2>
            <div class="property-addons addons">
                <button
                    v-for="addon in property.addons"
                    :key="addon.id"
                    :class="{'--active': addon.isActive}"
                    class="addon program-card-surface"
                    :aria-pressed="Boolean(addon.isActive)"
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
                                <svg class="__svg program-detail-icon">
                                    <use xlink:href="#cash"></use>
                                </svg>
                                {{ getPrice(addon.price) }}
                            </span>
                            <span class="price">
                                <svg class="__svg program-detail-icon">
                                    <use xlink:href="#clock"></use>
                                </svg>
                                {{ getNumber(addon.duration) + ' мин' }}
                            </span>
                        </span>
                    </span>
                </button>
            </div>
        </template>

        <fixed-actions label="Действия с выбранной программой">
            <template #leading>
                <router-link to="/programs" class="__button" aria-label="Назад" title="Назад">
                    <svg class="__svg --back" aria-hidden="true">
                        <use xlink:href="#arrow"></use>
                    </svg>
                </router-link>
            </template>
            <div>
                <router-link :to="`/programs/${program.id}/preorder`" class="__button --green --filled --medium">
                    <svg class="__svg" aria-hidden="true"><use xlink:href="#receipt" /></svg>
                    Итого {{ getPrice(order.total_amount) }}
                </router-link>
            </div>
            <template #trailing>
                <call-support-component :show-text="false" />
            </template>
        </fixed-actions>

    </main>

</template>

<style scoped>
.program-detail-icon {
    color: var(--green-color);
    width: 1.5em;
    height: 1.5em;
}

.program-view,
.program-view .name,
.program-view .addon,
.program-view .addon .content {
    min-width: 0;
    overflow-wrap: anywhere;
}

.program-view .property-addons {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.program-view .header,
.program-view .footer,
.program-view .addon .details {
    flex-wrap: wrap;
}

.program-view .property-program-details {
    --gradient-opacity: 0.75;
}

.program-view .property-addons .addon {
    --gradient-opacity: 0.4;
}

.program-view .property-program-details .header {
    align-items: flex-start;
    flex-wrap: nowrap;
    border: 0;
    margin-bottom: 0.85rem;
}

.program-view .property-program-details h2 {
    margin: 0;
    font-size: clamp(20px, 1.1rem, 40px);
    font-weight: 700;
}

.program-details-heading {
    min-width: 0;
}

.program-view .property-program-details .duration {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
}

.program-view .property-program-details .price {
    margin-left: auto;
}

</style>
