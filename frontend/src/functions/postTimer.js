const MINUTE_MS = 60_000;

export const getRemainingMs = timeLeftMinutes => {
    const minutes = Number(timeLeftMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return 0;
    }

    return minutes * MINUTE_MS;
};

export const tickRemainingMs = remainingMs => {
    return Math.max(Number(remainingMs || 0) - 1_000, 0);
};

export const formatRemainingMinutes = remainingMs => {
    const totalMinutes = Math.ceil(Number(remainingMs || 0) / MINUTE_MS);
    return totalMinutes > 0 ? `${totalMinutes} мин` : null;
};
