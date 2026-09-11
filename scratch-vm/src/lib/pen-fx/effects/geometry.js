/* eslint-disable */

import {mixAmount, number, numberOr} from '../helpers';

const MIRROR_TYPES = ['x', 'y', 'xy'];
const INTEGER_UNIFORMS = ['u_mode', 'u_type'];

const install = ({Engine, PenFX}) => {
    Engine.prototype.geometry = function (mode, type, uniforms, blendMode) {
        const value = uniforms.value;
        const radius = uniforms.radius;
        const center = uniforms.center;
        const offset = uniforms.offset;
        const anchor = uniforms.anchor;
        const blockSize = uniforms.blockSize;
        const size = uniforms.size;
        const direction = uniforms.direction;
        const width = uniforms.width;
        const frequency = uniforms.frequency;
        const mix = uniforms.mix;
        this._singlePass(this._program('geometry'), {
            u_resolution: this.resolution,
            u_mode: mode,
            u_type: type,
            u_value: value === undefined ? 0 : value,
            u_radius: radius === undefined ? 0 : radius,
            u_center: center || [0, 0],
            u_offset: offset || [0, 0],
            u_anchor: anchor || [0, 0],
            u_blockSize: blockSize || [1, 1],
            u_size: size === undefined ? 100 : size,
            u_direction: direction === undefined ? 0 : direction,
            u_width: width === undefined ? 6 : width,
            u_frequency: frequency === undefined ? 0.55 : frequency,
            u_mix: mix === undefined ? 1 : mix
        }, INTEGER_UNIFORMS, blendMode);
    };

    PenFX.prototype.pulse = function (args) {
        this._safe(engine => {
            const radius = number(args.RADIUS);
            return engine.geometry(0, 0, {
                center: [number(args.X), number(args.Y)],
                radius,
                value: number(args.VALUE),
                width: numberOr(args.WIDTH, Math.max(Math.abs(radius) * 0.22, 6)),
                frequency: numberOr(args.FREQUENCY, 0.55),
                mix: mixAmount(args.MIX)
            }, this.blendMode);
        });
    };

    PenFX.prototype.pixelate = function (args) {
        const oldSize = numberOr(args.SIZE, 8);
        this._safe(engine => engine.geometry(1, 0, {
            blockSize: [numberOr(args.X, oldSize), numberOr(args.Y, oldSize)],
            offset: [numberOr(args.OFFSETX, 0), numberOr(args.OFFSETY, 0)],
            mix: mixAmount(args.MIX)
        }, this.blendMode));
    };

    PenFX.prototype.mirror = function (args) {
        const type = MIRROR_TYPES.indexOf(String(args.TYPE));
        this._safe(engine => engine.geometry(2, Math.max(0, type), {
            center: [numberOr(args.X, 0), numberOr(args.Y, 0)], mix: mixAmount(args.MIX)
        }, this.blendMode));
    };

    PenFX.prototype.transform = function (args) {
        this._safe(engine => engine.geometry(3, 0, {
            offset: [number(args.X), number(args.Y)],
            size: number(args.SIZE),
            direction: number(args.DIR),
            anchor: [numberOr(args.ANCHORX, 0), numberOr(args.ANCHORY, 0)],
            mix: mixAmount(args.MIX)
        }, this.blendMode));
    };

    PenFX.prototype.duplicate = function (args) {
        this._safe(engine => engine.geometry(4, 0, {
            offset: [number(args.X), number(args.Y)],
            size: numberOr(args.SIZE, 50),
            direction: number(args.DIR),
            anchor: [numberOr(args.ANCHORX, 0), numberOr(args.ANCHORY, 0)],
            mix: mixAmount(args.MIX)
        }, this.blendMode));
    };
};

export default install;
