/* eslint-disable */

import {color, number} from '../helpers';

const install = ({Engine, PenFX}) => {
    Engine.prototype.deepGlow = function (threshold, radius, value, glowColor, blendMode) {
        this._singlePass(this._program('deepGlow'), {
            u_resolution: this.resolution,
            u_threshold: Math.min(1, Math.max(0, threshold > 1 ? threshold / 100 : threshold)),
            u_radius: Math.min(128, Math.max(0, Math.abs(radius))),
            u_value: Math.max(0, value),
            u_color: glowColor
        }, [], blendMode);
    };

    PenFX.prototype.deepGlow = function (args) {
        this._safe(engine => engine.deepGlow(number(args.THRESHOLD), number(args.RADIUS), number(args.VALUE),
            color(args.COLOR || '#ffffff'), this.blendMode));
    };
};

export default install;
