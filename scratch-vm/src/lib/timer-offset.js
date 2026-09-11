import Cast from '../util/cast';
import compilerCompatBlocks from '../compiler/compat-blocks';

const OPCODE = 'sensing_settimeroffsetto';
const TIMER_OFFSET_PROPERTY = '_shadingTimerOffset';
const RAW_TIMER_METHOD_PROPERTY = 'projectTimerWithoutOffset';
const ORIGINAL_TIMER_METHOD_PROPERTY = '_shadingOriginalProjectTimer';

/**
 * Apply an offset to the project timer, in seconds.
 *
 * The timer offset is kept separately from the Scratch clock's start time.
 * This lets timeline playback continue to use its own clock while every
 * regular project timer read sees the configured offset.
 *
 * @param {object} clock Scratch clock instance.
 * @param {*} offset Timer offset in seconds.
 * @returns {void}
 */
const setProjectTimerOffset = (clock, offset) => {
    if (!clock) return;
    const value = Cast.toNumber(offset);
    clock[TIMER_OFFSET_PROPERTY] = value;
};

/**
 * Install the sensing timer-offset primitive into a VM instance.
 *
 * @param {VirtualMachine} vm Scratch VM instance.
 * @returns {VirtualMachine} The same VM instance.
 */
const installTimerOffset = vm => {
    const clock = vm.runtime.ioDevices.clock;
    if (clock && typeof clock.projectTimer === 'function' && !clock[ORIGINAL_TIMER_METHOD_PROPERTY]) {
        const originalProjectTimer = clock.projectTimer.bind(clock);
        const originalResetProjectTimer = typeof clock.resetProjectTimer === 'function' ?
            clock.resetProjectTimer.bind(clock) : null;
        clock[TIMER_OFFSET_PROPERTY] = 0;
        clock[ORIGINAL_TIMER_METHOD_PROPERTY] = originalProjectTimer;
        clock[RAW_TIMER_METHOD_PROPERTY] = originalProjectTimer;
        clock.projectTimer = () => originalProjectTimer() + clock[TIMER_OFFSET_PROPERTY];
        if (originalResetProjectTimer) {
            clock.resetProjectTimer = () => {
                clock[TIMER_OFFSET_PROPERTY] = 0;
                return originalResetProjectTimer();
            };
        }
    }
    if (clock && typeof clock.setProjectTimerOffset !== 'function') {
        clock.setProjectTimerOffset = offset => setProjectTimerOffset(clock, offset);
    }

    vm.runtime._primitives[OPCODE] = (args, util) => {
        if (util && typeof util.ioQuery === 'function') {
            util.ioQuery('clock', 'setProjectTimerOffset', [Cast.toNumber(args.OFFSET)]);
        }
    };

    if (!compilerCompatBlocks.stacked.includes(OPCODE)) {
        compilerCompatBlocks.stacked.push(OPCODE);
        compilerCompatBlocks.stacked.sort();
    }
    return vm;
};

export {
    OPCODE,
    setProjectTimerOffset,
    installTimerOffset as default
};
