/* eslint-disable */

import {mixAmount, number, numberOr} from '../helpers';

const GAUSSIAN_TYPES = ['normal', 'horizontal', 'vertical'];

const install = ({Engine, PenFX}) => {
    Engine.prototype._gaussianPass = function (texture, framebuffer, direction, radius, radialType, twoDimensional, center, mixValue) {
        this._render(this._program('gaussian'), framebuffer, [{name: 'u_image', texture}], {
            u_resolution: this.resolution,
            u_direction: direction,
            u_radius: radius,
            u_radialType: radialType,
            u_twoDimensional: twoDimensional,
            u_center: center,
            u_mix: mixValue
        }, ['u_radialType', 'u_twoDimensional']);
    };

    Engine.prototype.gaussian = function (type, direction, radius, mixValue, blendMode) {
        if (this._isNoOp(mixValue, blendMode)) return;
        const skin = this._prepare();
        if (!skin) return;
        const safeRadius = Math.min(256, Math.max(0, Math.abs(radius)));
        const direct = this._canRenderDirectly(blendMode);
        if (!direct) this._ensureSecondaryBuffer();
        const target = direct ? (skin._framebuffer.framebuffer || skin._framebuffer) : this.framebuffers[1];
        if (type === 'normal') {
            if (direct && safeRadius > 0.001) {
                this._ensureSecondaryBuffer();
                this._gaussianPass(this.textures[0], this.framebuffers[1], [1, 0], safeRadius, -1, 2, [0, 0], 1);
                this._gaussianPass(this.textures[1], target, [0, 1], safeRadius, -1, 2, [0, 0], mixValue);
            } else {
                this._gaussianPass(this.textures[0], target, [0, 0], safeRadius, -1, 1, [0, 0], mixValue);
            }
        } else {
            const vector = type === 'horizontal' ? [1, 0] : type === 'vertical' ? [0, 1] : [
                Math.sin(direction * Math.PI / 180), Math.cos(direction * Math.PI / 180)
            ];
            this._gaussianPass(this.textures[0], target, vector, safeRadius, -1, 0, [0, 0], mixValue);
        }
        if (direct) this._markSkinChanged(skin);
        else this._finish(skin, this.textures[1], blendMode);
    };

    Engine.prototype.radial = function (type, radius, centerX, centerY, mixValue, blendMode) {
        if (this._isNoOp(mixValue, blendMode)) return;
        const skin = this._prepare();
        if (!skin) return;
        const direct = this._canRenderDirectly(blendMode);
        if (!direct) this._ensureSecondaryBuffer();
        const target = direct ? (skin._framebuffer.framebuffer || skin._framebuffer) : this.framebuffers[1];
        this._gaussianPass(this.textures[0], target, [0, 0], Math.min(256, Math.max(0, Math.abs(radius))),
            type === 'dir' ? 0 : 1, 0, [centerX, centerY], mixValue);
        if (direct) this._markSkinChanged(skin);
        else this._finish(skin, this.textures[1], blendMode);
    };

    PenFX.prototype.gaussianBlur = function (args) {
        const rawType = String(args.TYPE);
        const type = GAUSSIAN_TYPES.includes(rawType) ? rawType : 'normal';
        this._safe(engine => engine.gaussian(type, 0, number(args.VALUE), mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.directionalBlur = function (args) {
        this._safe(engine => engine.gaussian('directional', number(args.DIR), number(args.VALUE), mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.radialBlur = function (args) {
        const type = String(args.TYPE) === 'size' ? 'size' : 'dir';
        this._safe(engine => engine.radial(type, number(args.VALUE), numberOr(args.X, 0), numberOr(args.Y, 0), mixAmount(args.MIX), this.blendMode));
    };
};

export default install;
