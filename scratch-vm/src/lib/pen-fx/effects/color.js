/* eslint-disable */

import {color, mixAmount, number, numberOr} from '../helpers';

// Shared default vec3 uniforms and the integer-uniform list are read-only as
// far as Engine._render is concerned (values are copied via gl.uniform*fv /
// matched via indexOf), so every call can reference the same instances
// instead of allocating fresh ones per rendered frame.
const VEC3_ZERO = [0, 0, 0];
const VEC3_ONE = [1, 1, 1];
const COLOR_INTEGER_UNIFORMS = ['u_mode'];

const install = ({Engine, PenFX}) => {
    Engine.prototype.color = function (mode, uniforms, blendMode) {
        const mix = uniforms.mix === undefined ? 1 : uniforms.mix;
        if (this._isNoOp(mix, blendMode)) return;
        const skin = this._prepare();
        if (!skin) return;
        this._renderEffect(skin, this._program('color'), [{name: 'u_image', texture: this.textures[0]}], {
            u_mode: mode,
            u_value: uniforms.value === undefined ? 1 : uniforms.value,
            u_mix: mix,
            u_pivot: uniforms.pivot === undefined ? 0.5 : uniforms.pivot,
            u_color: uniforms.color || VEC3_ZERO,
            u_add: uniforms.add || VEC3_ZERO,
            u_mul: uniforms.mul || VEC3_ONE,
            u_div: uniforms.div || VEC3_ONE
        }, COLOR_INTEGER_UNIFORMS, blendMode);
    };

    const invokeColor = (mode, values) => function (args) {
        const uniforms = values(args);
        this._safe(engine => engine.color(mode, uniforms, this.blendMode));
    };
    PenFX.prototype.contrast = invokeColor(0, args => ({
        value: number(args.VALUE), pivot: numberOr(args.PIVOT, 0.5), mix: mixAmount(args.MIX)
    }));
    PenFX.prototype.brightness = invokeColor(1, args => ({
        color: color(args.COLOR), value: numberOr(args.VALUE, 1), mix: mixAmount(args.MIX)
    }));
    PenFX.prototype.gamma = invokeColor(2, args => ({value: number(args.VALUE), mix: mixAmount(args.MIX)}));
    PenFX.prototype.saturation = invokeColor(3, args => ({value: number(args.VALUE), mix: mixAmount(args.MIX)}));
    PenFX.prototype.colorAdjustment = invokeColor(4, args => ({
        add: color(args.ADD), mul: color(args.MUL), div: color(args.DIV), mix: mixAmount(args.MIX)
    }));
};

export default install;
