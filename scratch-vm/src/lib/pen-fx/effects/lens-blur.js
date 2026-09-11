/* eslint-disable */

import {mixAmount, number, numberOr} from '../helpers';

const install = ({Engine, PenFX}) => {
    Engine.prototype.lensBlur = function (radius, shape, rotation, mixValue, blendMode) {
        const blades = shape === 'hexagon' ? 6 : shape === 'octagon' ? 8 : 0;
        this._singlePass(this._program('lensBlur'), {
            u_resolution: this.resolution,
            u_radius: Math.min(256, Math.max(0, Math.abs(radius))),
            u_blades: blades,
            u_rotation: rotation,
            u_mix: mixValue
        }, [], blendMode);
    };

    PenFX.prototype.lensBlur = function (args) {
        const shapeName = String(args.SHAPE);
        const shape = shapeName === 'hexagon' || shapeName === 'octagon' ? shapeName : 'circle';
        this._safe(engine => engine.lensBlur(number(args.RADIUS), shape, numberOr(args.ROTATION, 0), mixAmount(args.MIX), this.blendMode));
    };
};

export default install;
