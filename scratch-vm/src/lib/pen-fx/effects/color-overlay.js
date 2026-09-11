/* eslint-disable */

import {color, mixAmount} from '../helpers';

const install = ({Engine, PenFX}) => {
    Engine.prototype.colorOverlay = function (overlayColor, mixValue, blendMode) {
        if (this._isNoOp(mixValue, blendMode)) return;
        const skin = this._prepare();
        if (!skin) return;
        this._renderEffect(skin, this._program('colorOverlay'), [{name: 'u_image', texture: this.textures[0]}], {
            u_color: overlayColor,
            u_mix: mixValue
        }, [], blendMode);
    };

    PenFX.prototype.colorOverlay = function (args) {
        this._safe(engine => engine.colorOverlay(color(args.COLOR || '#ffffff'), mixAmount(args.MIX), this.blendMode));
    };
};

export default install;
