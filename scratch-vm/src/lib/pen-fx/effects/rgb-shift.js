/* eslint-disable */

import {mixAmount, number} from '../helpers';

const RGB_PAIRS = ['RG', 'GB', 'BR'];

const install = ({Engine, PenFX}) => {
    Engine.prototype.rgbShift = function (direction, value, pair, mixValue, blendMode) {
        if (this._isNoOp(mixValue, blendMode)) return;
        const skin = this._prepare();
        if (!skin) return;
        this._renderEffect(skin, this._program('rgbShift'), [{name: 'u_image', texture: this.textures[0]}], {
            u_resolution: this.resolution,
            u_direction: direction,
            u_value: value,
            u_pair: pair,
            u_mix: mixValue
        }, ['u_pair'], blendMode);
    };

    PenFX.prototype.rgbShift = function (args) {
        const pair = RGB_PAIRS.indexOf(String(args.COLOR).toUpperCase());
        this._safe(engine => engine.rgbShift(number(args.DIR), number(args.VALUE), Math.max(0, pair), mixAmount(args.MIX), this.blendMode));
    };
};

export default install;
