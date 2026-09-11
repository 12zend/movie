/* eslint-disable */

import {evolutionAmount, mixAmount, numberOr, seedAmount} from '../helpers';

// Read-only downstream (_render only calls indexOf), safe to share across calls.
const MODE_INTEGER_UNIFORMS = ['u_mode'];

const install = ({Engine, PenFX}) => {
    Engine.prototype.vhs = function (tracking, chroma, noise, scanlines, seed, evolution, mixValue, blendMode) {
        this._singlePass(this._program('signal'), {
            u_resolution: this.resolution,
            u_mode: 0,
            u_tracking: Math.min(128, Math.max(0, Math.abs(tracking))),
            u_chroma: Math.min(64, Math.max(0, Math.abs(chroma))),
            u_noise: Math.min(1, Math.max(0, noise)),
            u_scanlines: Math.min(1, Math.max(0, scanlines)),
            u_seed: seed,
            u_evolution: evolution,
            u_slices: 1,
            u_shift: 0,
            u_rgb: 0,
            u_density: 0,
            u_mix: mixValue
        }, MODE_INTEGER_UNIFORMS, blendMode);
    };

    Engine.prototype.digitalGlitch = function (slices, shift, rgb, density, seed, evolution, mixValue, blendMode) {
        this._singlePass(this._program('signal'), {
            u_resolution: this.resolution,
            u_mode: 1,
            u_tracking: 0,
            u_chroma: 0,
            u_noise: 0,
            u_scanlines: 0,
            u_seed: seed,
            u_evolution: evolution,
            u_slices: Math.min(256, Math.max(1, Math.round(Math.abs(slices)))),
            u_shift: Math.min(512, Math.max(0, Math.abs(shift))),
            u_rgb: Math.min(128, Math.max(0, Math.abs(rgb))),
            u_density: Math.min(1, Math.max(0, density)),
            u_mix: mixValue
        }, MODE_INTEGER_UNIFORMS, blendMode);
    };

    PenFX.prototype.vhs = function (args) {
        this._safe(engine => engine.vhs(numberOr(args.TRACKING, 6), numberOr(args.CHROMA, 3),
            numberOr(args.NOISE, 12) / 100, numberOr(args.SCANLINES, 25) / 100,
            seedAmount(args.SEED), evolutionAmount(args.EVOLUTION), mixAmount(args.MIX), this.blendMode),
        {groupEffectScope: 'expanded'});
    };

    PenFX.prototype.glitch = function (args) {
        this._safe(engine => engine.digitalGlitch(numberOr(args.SLICES, 24), numberOr(args.SHIFT, 28),
            numberOr(args.RGB, 6), numberOr(args.DENSITY, 35) / 100, seedAmount(args.SEED), evolutionAmount(args.EVOLUTION),
            mixAmount(args.MIX), this.blendMode),
        {groupEffectScope: 'expanded'});
    };
};

export default install;
