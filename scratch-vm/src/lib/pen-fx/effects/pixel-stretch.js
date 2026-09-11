/* eslint-disable */

import {mixAmount, number, numberOr} from '../helpers';

const TYPES = ['x', 'y', 'size', 'dir'];

const install = ({Engine, PenFX}) => {
    Engine.prototype.pixelStretch = function (type, position, size, sampleSize, centerX, centerY, mixValue, blendMode) {
        this._singlePass(this._program('pixelStretch'), {
            u_resolution: this.resolution,
            u_type: Math.max(0, TYPES.indexOf(type)),
            u_position: position,
            u_size: Math.max(0, Math.abs(size)),
            u_sampleSize: Math.min(9, Math.max(1, Math.abs(sampleSize))),
            u_center: [centerX, centerY],
            u_mix: mixValue
        }, ['u_type'], blendMode);
    };

    PenFX.prototype.pixelStretch = function (args) {
        const rawType = String(args.TYPE);
        const type = TYPES.includes(rawType) ? rawType : 'x';
        this._safe(engine => engine.pixelStretch(type, number(args.POSITION), number(args.SIZE),
            numberOr(args.SAMPLE, 1), number(args.CENTERX), number(args.CENTERY), mixAmount(args.MIX), this.blendMode));
    };
};

export default install;
