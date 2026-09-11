/* eslint-disable */

import {color, depthResource, mixAmount, numberOr} from '../helpers';

const FOG_TYPES = ['linear', 'smooth', 'exponential', 'exponential squared'];

const install = ({Engine, PenFX}) => {
    Engine.prototype.fog = function (depthBuffer, type, start, end, density, curve, nearColor, farColor, mixValue, blendMode) {
        if (!depthBuffer || this._isNoOp(mixValue, blendMode)) return;
        const skin = this._prepare();
        if (!skin) return;
        const flatDepth = Number(depthBuffer.flatDepth);
        const hasFlatDepth = Number.isFinite(flatDepth) && flatDepth > 0;
        const depthTexture = hasFlatDepth ? this.textures[0] : this._uploadDepthBuffer(depthBuffer);
        if (!depthTexture) return;
        const cameraNear = hasFlatDepth ? 0.1 : Math.max(0.0001, Number(depthBuffer.near) || 0.1);
        const cameraFar = hasFlatDepth ? 1 : Math.max(cameraNear + 0.0001, Number(depthBuffer.far) || 1);
        const mode = Math.max(0, FOG_TYPES.indexOf(type));
        this._renderEffect(skin, this._program('fog'), [
            {name: 'u_image', texture: this.textures[0]},
            {name: 'u_depth', texture: depthTexture}
        ], {
            u_cameraNear: cameraNear,
            u_cameraFar: cameraFar,
            u_flatDepth: hasFlatDepth ? flatDepth : -1,
            u_mode: mode,
            u_start: start,
            u_end: end,
            u_density: Math.min(1, Math.max(0, density)),
            u_curve: Math.min(100, Math.max(0.01, curve)),
            u_nearColor: nearColor,
            u_farColor: farColor,
            u_mix: mixValue
        }, ['u_mode'], blendMode);
    };

    PenFX.prototype.fog = function (args, util) {
        const typeKey = String(args.TYPE);
        const type = FOG_TYPES.includes(typeKey) ? typeKey : 'linear';
        this._safe((engine, renderContext) => engine.fog(depthResource(renderContext), type, numberOr(args.START, 100),
            numberOr(args.END, 1000), numberOr(args.DENSITY, 100) / 100, numberOr(args.CURVE, 1),
            color(args.NEARCOLOR || '#d9e7f2'), color(args.FARCOLOR || '#ffffff'), mixAmount(args.MIX), this.blendMode), {
            target: util && util.target
        });
    };
};

export default install;
