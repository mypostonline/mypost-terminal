const qrAnimationStates = new WeakMap();

const getNextAngle = (currentAngle) => {
    if (currentAngle === null) {
        return Math.random() * 360;
    }

    const minimumShift = 60;
    const shift = minimumShift + Math.random() * (360 - minimumShift * 2);

    return (currentAngle + shift) % 360;
};

export default {
    mounted(element) {
        const state = {
            angle: null,
            onAnimationIteration: null,
        };

        const applyNextAngle = () => {
            state.angle = getNextAngle(state.angle);
            element.style.setProperty(
                '--qr-start-angle',
                `${state.angle.toFixed(2)}deg`
            );
        };

        state.onAnimationIteration = (event) => {
            if (event.animationName === 'qr-border-ray-run') {
                applyNextAngle();
            }
        };

        qrAnimationStates.set(element, state);
        applyNextAngle();
        element.addEventListener(
            'animationiteration',
            state.onAnimationIteration
        );
    },

    unmounted(element) {
        const state = qrAnimationStates.get(element);

        if (!state) {
            return;
        }

        element.removeEventListener(
            'animationiteration',
            state.onAnimationIteration
        );
        qrAnimationStates.delete(element);
    },
};
