/* eslint-disable */

import {depthResource, mixAmount, numberOr} from '../helpers';

const SHAPES = ['circle', 'hexagon', 'octagon'];

const install = ({Engine, PenFX}) => {
    Engine.prototype.depthOfField = function (depthBuffer, focusDistance, focusRange, aperture, maxBlur, nearStrength,
        farStrength, edgeSoftness, shape, rotation, mixValue, blendMode) {
        if (!depthBuffer || this._isNoOp(mixValue, blendMode)) return;
        const skin = this._prepare();
        if (!skin) return;
        const flatDepth = Number(depthBuffer.flatDepth);
        const hasFlatDepth = Number.isFinite(flatDepth) && flatDepth > 0;
        const depthTexture = hasFlatDepth ? this.textures[0] : this._uploadDepthBuffer(depthBuffer);
        if (!depthTexture) return;
        const cameraNear = hasFlatDepth ? 0.1 : Math.max(0.0001, Number(depthBuffer.near) || 0.1);
        const cameraFar = hasFlatDepth ? 1 : Math.max(cameraNear + 0.0001, Number(depthBuffer.far) || 1);
        const blades = shape === 'hexagon' ? 6 : shape === 'octagon' ? 8 : 0;
        this._renderEffect(skin, this._program('depthOfField'), [
            {name: 'u_image', texture: this.textures[0]},
            {name: 'u_depth', texture: depthTexture}
        ], {
            u_resolution: this.resolution,
            u_cameraNear: cameraNear,
            u_cameraFar: cameraFar,
            u_flatDepth: hasFlatDepth ? flatDepth : -1,
            u_focusDistance: Math.max(0.0001, focusDistance),
            u_focusRange: Math.max(0, focusRange),
            u_aperture: Math.min(512, Math.max(0, aperture)),
            u_maxBlur: Math.min(128, Math.max(0, maxBlur)),
            u_nearStrength: Math.min(4, Math.max(0, nearStrength)),
            u_farStrength: Math.min(4, Math.max(0, farStrength)),
            u_edgeSoftness: Math.max(0, edgeSoftness),
            u_blades: blades,
            u_rotation: rotation,
            u_mix: mixValue
        }, [], blendMode);
    };

    PenFX.prototype.depthOfField = function (args, util) {
        const shapeName = String(args.SHAPE);
        const shape = SHAPES.includes(shapeName) ? shapeName : 'circle';
        this._safe((engine, renderContext) => engine.depthOfField(depthResource(renderContext),
            numberOr(args.FOCUS, 480), numberOr(args.RANGE, 24), numberOr(args.APERTURE, 48),
            numberOr(args.MAXBLUR, 24), numberOr(args.NEAR, 100) / 100, numberOr(args.FAR, 100) / 100,
            numberOr(args.EDGE, 8), shape, numberOr(args.ROTATION, 0), mixAmount(args.MIX), this.blendMode), {
            target: util && util.target
        });
    };
};

export default install;
