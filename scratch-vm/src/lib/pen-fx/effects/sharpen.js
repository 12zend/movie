/* eslint-disable */

import {mixAmount, number, numberOr} from '../helpers';

const install = ({Engine, PenFX}) => {
    Engine.prototype.sharpen = function (value, radius, mixValue, blendMode) {
        this._singlePass(this._program('sharpen'), {
            u_resolution: this.resolution,
            u_value: Math.min(8, Math.max(0, value)),
            u_radius: Math.min(8, Math.max(1, Math.abs(radius))),
            u_mix: mixValue
        }, [], blendMode);
    };

    PenFX.prototype.sharpen = function (args) {
        this._safe(engine => engine.sharpen(number(args.VALUE), numberOr(args.RADIUS, 1), mixAmount(args.MIX), this.blendMode));
    };
};

export default install;
