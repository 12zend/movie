/* eslint-disable */

import {FRACTAL_NOISE_TYPES, FRACTAL_OVERFLOW_TYPES, FRACTAL_TYPES} from '../constants';
import {boolean, evolutionAmount, mixAmount, number, numberOr} from '../helpers';

const install = ({Engine, PenFX}) => {
    Engine.prototype.fractalNoise = function (fractalType, noiseType, invert, contrast, brightness, overflow, rotation, scale,
        width, height, offsetX, offsetY, perspective, depth, evolution, cycleEvolution, cycle, blendMode) {
        this._singlePass(this._program('fractalNoise'), {
            u_resolution: this.resolution,
            u_fractalType: Math.max(0, FRACTAL_TYPES.indexOf(fractalType)),
            u_noiseType: Math.max(0, FRACTAL_NOISE_TYPES.indexOf(noiseType)),
            u_invert: invert ? 1 : 0,
            u_contrast: contrast,
            u_brightness: brightness,
            u_overflow: Math.max(0, FRACTAL_OVERFLOW_TYPES.indexOf(overflow)),
            u_rotation: rotation,
            u_scale: scale,
            u_scaleDimensions: [width, height],
            u_offset: [offsetX, offsetY],
            u_perspective: perspective ? 1 : 0,
            u_depth: Math.min(10, Math.max(1, depth)),
            u_evolution: evolution,
            u_cycleEvolution: cycleEvolution ? 1 : 0,
            u_cycle: cycle
        }, ['u_fractalType', 'u_noiseType', 'u_invert', 'u_overflow', 'u_perspective', 'u_cycleEvolution'], blendMode);
    };

    PenFX.prototype.fractalnoise = function (args) {
        const rawFractalType = String(args.FRACTALTYPE);
        const rawNoiseType = String(args.NOISETYPE);
        const rawOverflow = String(args.OVERFLOW);
        const fractalType = FRACTAL_TYPES.includes(rawFractalType) ?
            rawFractalType : FRACTAL_TYPES[0];
        const noiseType = FRACTAL_NOISE_TYPES.includes(rawNoiseType) ?
            rawNoiseType : FRACTAL_NOISE_TYPES[0];
        const overflow = FRACTAL_OVERFLOW_TYPES.includes(rawOverflow) ?
            rawOverflow : FRACTAL_OVERFLOW_TYPES[0];
        this._safe(engine => engine.fractalNoise(fractalType, noiseType, boolean(args.INVERT),
            numberOr(args.CONTRAST, 100), number(args.BRIGHTNESS), overflow, number(args.ROTATE),
            numberOr(args.SCALE, 100), numberOr(args.WIDTH, 100), numberOr(args.HEIGHT, 100),
            number(args.OX), number(args.OY), boolean(args.PERSPECTIVE), numberOr(args.DEPTH, 6),
            evolutionAmount(args.EVOLUTION), boolean(args.CYCLEEVOLUTION), numberOr(args.FREQ, 1), this.blendMode));
    };
};

export default install;
