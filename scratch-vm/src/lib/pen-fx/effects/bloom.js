/* eslint-disable */

import {boolean, color, mixAmount, number} from '../helpers';

const INTEGER_UNIFORMS = ['u_invert'];

const install = ({Engine, PenFX}) => {
    Engine.prototype.bloom = function (threshold, radius, value, invert, glowColor, blendMode) {
        const skin = this._prepare();
        if (!skin) return;
        const normalizedThreshold = threshold > 1 ? threshold / 100 : threshold;
        const safeRadius = Math.min(256, Math.max(0, Math.abs(radius)));
        this._renderEffect(skin, this._program('bloom'), [{name: 'u_image', texture: this.textures[0]}], {
            u_resolution: this.resolution,
            u_threshold: Math.min(1, Math.max(0, normalizedThreshold)),
            u_radius: safeRadius,
            u_value: value,
            u_invert: invert ? 1 : 0,
            u_color: glowColor
        }, INTEGER_UNIFORMS, blendMode);
    };

    PenFX.prototype.bloom = function (args) {
        this._safe(engine => engine.bloom(number(args.THRESHOLD), number(args.RADIUS), number(args.VALUE),
            boolean(args.INVERT), color(args.COLOR || '#ffffff'), this.blendMode));
    };
};

export default install;
