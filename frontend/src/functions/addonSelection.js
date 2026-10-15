const addonId = (value) => String(value);

const optionIds = (addon) => Array.isArray(addon.options)
    ? addon.options.map(option => addonId(option.id))
    : [];

export const deriveAddonSelection = (addons, program, selectedAddonIds) => {
    const includedIds = new Set((program?.included_addons || []).map(addon => addonId(addon.id)));
    const excludedIds = new Set((program?.excluded_addons || []).map(addon => addonId(addon.id)));
    const excludedSingleOptions = new Set(
        addons
            .filter(addon => excludedIds.has(addonId(addon.id)) && optionIds(addon).length === 1)
            .flatMap(optionIds),
    );

    const isExcluded = (addon) => excludedIds.has(addonId(addon.id)) || (
        optionIds(addon).length > 1 &&
        optionIds(addon).some(id => excludedSingleOptions.has(id))
    );

    const coveredOptions = new Set();
    addons.forEach(addon => {
        if (optionIds(addon).length > 1 && !isExcluded(addon) &&
            (includedIds.has(addonId(addon.id)) || selectedAddonIds.has(addonId(addon.id)))) {
            optionIds(addon).forEach(id => coveredOptions.add(id));
        }
    });

    return addons.map(addon => {
        const excluded = isExcluded(addon);
        const included = !excluded && includedIds.has(addonId(addon.id));
        const composite = !excluded && optionIds(addon).length === 1 &&
            coveredOptions.has(optionIds(addon)[0]);

        return {
            ...addon,
            isActive: !excluded && (included || composite || selectedAddonIds.has(addonId(addon.id))),
            isIncluded: included,
            isExcluded: excluded,
            isComposite: composite,
        };
    });
};
