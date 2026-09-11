import compilerCompatBlocks from '../compiler/compat-blocks';

/**
 * Easing calculations used by Movie's timer-driven easing reporter block.
 *
 * The functions in this file deliberately do not depend on the VM. Keeping the
 * calculation pure makes the behavior easy to test and reuse from other Movie
 * features in the future.
 */

const EASING_TYPES = [
    'PowerIn',
    'PowerOut',
    'PowerInOut',
    'CircIn',
    'CircOut',
    'CircInOut',
    'ExpoIn',
    'ExpoOut',
    'ExpoInOut'
];

const EASING_SECONDARY_TYPES = ['Elastic', 'Bounce'];

// Keep EASING_TYPES stable for projects created with the original operator_easing block.
// Objects uses the expanded set below as its shared animation vocabulary.
const ANIMATION_EASING_TYPES = [
    'Linear',
    'PowerIn',
    'PowerOut',
    'PowerInOut',
    'CircIn',
    'CircOut',
    'CircInOut',
    'ExpoIn',
    'ExpoOut',
    'ExpoInOut',
    'BackIn',
    'BackOut',
    'BackInOut'
];

const clamp01 = value => Math.max(0, Math.min(1, value));

const finiteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const normalizePower = value => Math.max(1, Math.abs(finiteNumber(value, 2)));

const powerIn = (progress, power) => Math.pow(progress, power);
const powerOut = (progress, power) => 1 - Math.pow(1 - progress, power);
const powerInOut = (progress, power) => {
    if (progress < 0.5) {
        return Math.pow(2, power - 1) * Math.pow(progress, power);
    }
    return 1 - (Math.pow((-2 * progress) + 2, power) / 2);
};

const circIn = (progress, power) => 1 - Math.pow(1 - Math.pow(progress, power), 1 / power);
const circOut = (progress, power) => Math.pow(1 - Math.pow(1 - progress, power), 1 / power);
const circInOut = (progress, power) => {
    if (progress < 0.5) {
        return (1 - Math.pow(1 - Math.pow(2 * progress, power), 1 / power)) / 2;
    }
    return (1 + Math.pow(1 - Math.pow(2 - (2 * progress), power), 1 / power)) / 2;
};

const EXPO_EXPONENT = 10;
const BACK_OVERSHOOT = 1.70158;

const expoIn = progress => {
    if (progress === 0) return 0;
    return Math.pow(2, EXPO_EXPONENT * (progress - 1));
};
const expoOut = progress => {
    if (progress === 1) return 1;
    return 1 - Math.pow(2, -EXPO_EXPONENT * progress);
};
const expoInOut = progress => {
    if (progress === 0 || progress === 1) return progress;
    if (progress < 0.5) {
        return Math.pow(2, EXPO_EXPONENT * ((2 * progress) - 1)) / 2;
    }
    return (2 - Math.pow(2, -EXPO_EXPONENT * ((2 * progress) - 1))) / 2;
};

const backIn = progress => (
    ((BACK_OVERSHOOT + 1) * progress * progress * progress) -
    (BACK_OVERSHOOT * progress * progress)
);
const backOut = progress => {
    const shifted = progress - 1;
    return 1 + ((BACK_OVERSHOOT + 1) * shifted * shifted * shifted) +
        (BACK_OVERSHOOT * shifted * shifted);
};
const backInOut = progress => {
    const overshoot = BACK_OVERSHOOT * 1.525;
    if (progress < 0.5) {
        const doubled = progress * 2;
        return (doubled * doubled * (((overshoot + 1) * doubled) - overshoot)) / 2;
    }
    const shifted = (progress * 2) - 2;
    return ((shifted * shifted * (((overshoot + 1) * shifted) + overshoot)) + 2) / 2;
};

const easingFunctions = {
    Linear: progress => progress,
    PowerIn: powerIn,
    PowerOut: powerOut,
    PowerInOut: powerInOut,
    CircIn: circIn,
    CircOut: circOut,
    CircInOut: circInOut,
    ExpoIn: expoIn,
    ExpoOut: expoOut,
    ExpoInOut: expoInOut,
    BackIn: backIn,
    BackOut: backOut,
    BackInOut: backInOut
};

const normalizeEasingType = value => {
    const compact = String(value || '')
        .replace(/[\s_-]+/g, '')
        .toLowerCase();
    return ANIMATION_EASING_TYPES.find(type => type.toLowerCase() === compact) || 'Linear';
};

const normalizeEasingType2 = value => {
    const compact = String(value || '')
        .replace(/[\s_-]+/g, '')
        .toLowerCase();
    return EASING_SECONDARY_TYPES.find(type => type.toLowerCase() === compact) || 'Elastic';
};

const normalizeStrength = value => Math.max(0, Math.abs(finiteNumber(value, 1)));

const secondaryEasingOffsets = {
    // Keep the original speed-driven Elastic behavior when strength is 1.
    Elastic: (elapsed, speed) => 1 - Math.cos(elapsed * speed),
    Bounce: (elapsed, speed) => Math.abs(Math.sin(elapsed * speed))
};

const calculateEasingProgress = (type, progress, power = 2) => {
    const normalizedProgress = clamp01(finiteNumber(progress));
    const easing = easingFunctions[normalizeEasingType(type)] || easingFunctions.Linear;
    return easing(normalizedProgress, normalizePower(power));
};

/**
 * Calculate a value between v0 and v1 using the Scratch project timer.
 *
 * Speed adds an elastic oscillation to the remaining distance. With speed 0,
 * cos(0) is 1, so the expression reduces exactly to the selected easing.
 *
 * @param {object} options Easing block arguments.
 * @param {string} options.type Selected easing type.
 * @param {number} options.v0 Value at t0.
 * @param {number} options.v1 Value at t1.
 * @param {number} options.t0 Start time in seconds.
 * @param {number} options.t1 End time in seconds.
 * @param {string} options.type2 Secondary easing effect.
 * @param {number} options.power Exponent of the primary easing curve.
 * @param {number} options.speed Secondary easing angular speed in radians per second.
 * @param {number} options.strength Intensity of the secondary easing effect.
 * @param {number} timer Current Scratch project timer in seconds.
 * @returns {number} Interpolated value.
 */
const calculateEasingValue = ({
    type,
    type2 = 'Elastic',
    v0,
    v1,
    t0,
    t1,
    power,
    speed,
    strength = 1
}, timer) => {
    const startValue = finiteNumber(v0);
    const endValue = finiteNumber(v1);
    const startTime = finiteNumber(t0);
    const endTime = finiteNumber(t1);
    const currentTime = finiteNumber(timer);

    if (endTime <= startTime) {
        return currentTime < startTime ? startValue : endValue;
    }
    if (currentTime <= startTime) return startValue;
    if (currentTime >= endTime) return endValue;

    const progress = clamp01((currentTime - startTime) / (endTime - startTime));
    const easingType = EASING_TYPES.includes(type) ? type : 'PowerIn';
    const easedProgress = calculateEasingProgress(easingType, progress, power);
    const angularSpeed = finiteNumber(speed);
    const elapsed = currentTime - startTime;
    const secondaryType = normalizeEasingType2(type2);
    const secondaryOffset = secondaryEasingOffsets[secondaryType](elapsed, angularSpeed);
    const secondaryProgress = easedProgress + (secondaryOffset * (1 - easedProgress) * normalizeStrength(strength));

    return startValue + ((endValue - startValue) * secondaryProgress);
};

/**
 * Install Movie's native operator primitive into a VM instance. The compiler
 * compatibility entry keeps the block working when TurboWarp compilation is
 * enabled, while still using the same project timer as Scratch's timer block.
 *
 * @param {VirtualMachine} vm Scratch VM instance.
 * @returns {VirtualMachine} The same VM instance.
 */
const installMovieEasing = vm => {
    vm.runtime._primitives.operator_easing = (args, util) => calculateEasingValue({
        type: args.TYPE,
        type2: args.TYPE2,
        v0: args.V0,
        v1: args.V1,
        t0: args.T0,
        t1: args.T1,
        power: args.POWER,
        speed: args.SPEED,
        strength: args.STRENGTH
    }, util.ioQuery('clock', 'projectTimer'));

    if (!compilerCompatBlocks.inputs.includes('operator_easing')) {
        compilerCompatBlocks.inputs.push('operator_easing');
        compilerCompatBlocks.inputs.sort();
    }
    return vm;
};

export {
    ANIMATION_EASING_TYPES,
    EASING_TYPES,
    EASING_SECONDARY_TYPES,
    calculateEasingProgress,
    calculateEasingValue,
    normalizeEasingType,
    normalizeEasingType2,
    installMovieEasing as default
};
