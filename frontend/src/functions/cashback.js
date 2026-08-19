const asFiniteNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

export const getCashbackLoyalty = loyalties => {
    if (!Array.isArray(loyalties)) {
        return null;
    }

    return loyalties.find(loyalty => {
        return loyalty?.type === 'cashback' &&
            asFiniteNumber(loyalty.percent) > 0;
    }) || null;
};

export const calculateCashbackAmount = (amount, percent) => {
    const normalizedAmount = asFiniteNumber(amount);
    const normalizedPercent = asFiniteNumber(percent);

    if (normalizedAmount <= 0 || normalizedPercent <= 0) {
        return 0;
    }

    const cashbackAmount = normalizedAmount * normalizedPercent / 100;
    return Math.round((cashbackAmount + Number.EPSILON) * 100) / 100;
};
