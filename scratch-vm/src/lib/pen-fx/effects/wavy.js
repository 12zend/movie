/* eslint-disable */

import {evolutionAmount, mixAmount, number, numberOr, seedAmount} from '../helpers';

const WAVY_TYPES = ['both', 'x', 'y', 'size', 'dir'];

const install = ({Engine, PenFX}) => {
    Engine.prototype.wavy = function (value, seed, offsetX, offsetY, size, complexity, evolution, type, centerX, centerY,
        mixValue, blendMode) {
        if (this._isNoOp(mixValue, blendMode)) return;
        const skin = this._prepare();
        if (!skin) return;
        this._renderEffect(skin, this._program('wavy'), [{name: 'u_image', texture: this.textures[0]}], {
            u_resolution: this.resolution,
            u_value: value,
            u_seed: seed,
            u_offset: [offsetX, offsetY],
            u_center: [centerX, centerY],
            u_size: size,
            u_complexity: Math.min(8, Math.max(1, complexity)),
            u_evolution: evolution,
            u_type: Math.max(0, WAVY_TYPES.indexOf(type)),
            u_mix: mixValue
        }, ['u_type'], blendMode);
    };

    PenFX.prototype.wavy = function (args) {
        const rawType = String(args.TYPE);
        const type = WAVY_TYPES.includes(rawType) ? rawType : 'both';
        this._safe(engine => engine.wavy(number(args.VALUE), seedAmount(args.SEED), number(args.X), number(args.Y),
            number(args.SIZE), numberOr(args.COMPLEXITY, 3), evolutionAmount(args.EVOLUTION), type,
            number(args.CENTERX), number(args.CENTERY), mixAmount(args.MIX), this.blendMode));
    };
};

export default install;
