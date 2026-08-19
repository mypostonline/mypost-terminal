export const getSecondsUntil = (deadline, now = Date.now()) => {
    const deadlineMs = Date.parse(deadline);
    if (!Number.isFinite(deadlineMs)) {
        return 0;
    }

    return Math.max(Math.ceil((deadlineMs - now) / 1000), 0);
};

export const formatCountdown = seconds => {
    const normalized = Math.max(Math.floor(Number(seconds) || 0), 0);
    const minutes = Math.floor(normalized / 60);
    const remainingSeconds = normalized % 60;
    return `${String(minutes).padStart(2, '0')}:${String(
        remainingSeconds
    ).padStart(2, '0')}`;
};
