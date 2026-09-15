const PAYMENT_METHOD_DEFINITIONS = {
    card: {
        code: 'card',
        paymentMethod: 'vendotek',
        actionLabel: 'Оплатить картой',
        label: 'Картой',
        description: 'Банковской картой или телефоном',
        //icon: 'bank-card',
        icon: 'nfc_green',
    },
    cash: {
        code: 'cash',
        paymentMethod: 'cash',
        actionLabel: 'Оплатить наличными',
        label: 'Наличными',
        description: 'Через купюроприёмник',
        icon: 'cash',
    },
};

// Display-only until an SBP payment integration is configured.
export const SBP_PAYMENT_METHOD = {
    code: 'sbp',
    actionLabel: 'Оплатить по СБП',
    label: 'По СБП',
    icon: 'sbp',
    available: false,
    unavailableLabel: '',
};

const PAYMENT_METHOD_ALIASES = {
    bank_card: 'card',
    card: 'card',
    vendotek: 'card',
    cash: 'cash',
};

const envPaymentMethods = (import.meta.env.VITE_PAYMENT_METHODS || 'card')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

export const getPaymentMethodCode = (item) => {
    const value = typeof item === 'string'
        ? item
        : item?.code || item?.type || item?.payment_method;

    return PAYMENT_METHOD_ALIASES[String(value || '').toLowerCase()];
};

export const getConfiguredPaymentMethods = (
    post,
    runtimeMethods = null
) => {
    const configuredMethods = Array.isArray(post?.payment_methods)
        ? post.payment_methods
        : envPaymentMethods;
    const addedMethods = new Set();

    return configuredMethods.reduce((result, item) => {
        if (typeof item === 'object' && item?.enabled === false) {
            return result;
        }

        const code = getPaymentMethodCode(item);
        const definition = PAYMENT_METHOD_DEFINITIONS[code];

        if (!definition || addedMethods.has(code)) {
            return result;
        }

        addedMethods.add(code);
        const configuredAvailable =
            typeof item !== 'object' || item?.available !== false;
        const runtimeMethod = runtimeMethods?.[code];
        const runtimeAvailable = runtimeMethod
            ? runtimeMethod.available === true
            : true;

        result.push({
            ...definition,
            paymentMethod: typeof item === 'object' && item?.payment_method
                ? item.payment_method
                : definition.paymentMethod,
            available: configuredAvailable && runtimeAvailable,
            unavailableLabel:
                (typeof item === 'object'
                    ? item?.unavailable_label
                    : undefined) ||
                runtimeMethod?.unavailableLabel,
        });

        return result;
    }, []);
};
