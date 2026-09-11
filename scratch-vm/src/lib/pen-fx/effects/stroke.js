/* eslint-disable */

import {color, numberOr} from '../helpers';

const install = ({Engine, PenFX}) => {
    Engine.prototype.stroke = function (strokeColor, width, blendMode) {
        const safeWidth = Math.min(64, Math.max(0, Math.abs(width)));
        if (safeWidth <= 0) return;
        this._singlePass(this._program('stroke'), {
            u_resolution: this.resolution,
            u_color: strokeColor,
            u_width: safeWidth
        }, [], blendMode);
    };

    PenFX.prototype.stroke = function (args) {
        this._safe(engine => engine.stroke(color(args.COLOR || '#000000'), numberOr(args.WIDTH, 4), this.blendMode));
    };
};

export default install;
