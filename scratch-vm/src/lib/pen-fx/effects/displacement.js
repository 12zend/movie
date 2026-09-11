/* eslint-disable */

import {boolean, mixAmount, number, numberOr} from '../helpers';

const TYPE_NAMES = ['x', 'y', 'size', 'dir'];
const CHANNEL_NAMES = ['luminance', 'r', 'g', 'b', 'a'];

const install = ({Engine, PenFX}) => {
    Engine.prototype.displacement = function (costume, value, type, channel, invert, center, mixValue, target, blendMode) {
        if (this.blendOpacity <= 0 || this._isNoOp(mixValue, blendMode)) return;
        const mapTexture = this._costumeTexture(costume, target);
        if (!mapTexture) return;
        const skin = this._prepare();
        if (!skin) return;
        const typeIndex = TYPE_NAMES.indexOf(type);
        const channelIndex = CHANNEL_NAMES.indexOf(channel);
        this._renderEffect(skin, this._program('displacement'), [
            {name: 'u_image', texture: this.textures[0]},
            {name: 'u_map', texture: mapTexture}
        ], {
            u_resolution: this.resolution,
            u_value: value,
            u_type: Math.max(0, typeIndex),
            u_channel: Math.max(0, channelIndex),
            u_invert: invert ? 1 : 0,
            u_center: center,
            u_mix: mixValue
        }, ['u_type', 'u_channel', 'u_invert'], blendMode);
    };

    Engine.prototype._costumeTexture = function (costumeName, target) {
        const renderer = this.renderer;
        if (!target || typeof target.getCostumes !== 'function' || !renderer._allSkins) return null;
        const costumes = target.getCostumes();
        let costume = costumes.find(item => item.name === String(costumeName));
        if (!costume) {
            const numericIndex = Math.floor(Number(costumeName)) - 1;
            if (Number.isFinite(numericIndex)) costume = costumes[numericIndex];
        }
        if (!costume) return null;
        const skin = renderer._allSkins[costume.skinId];
        // Reuse the renderer texture so this block never waits for an Image load.
        return skin && typeof skin.getTexture === 'function' ? skin.getTexture([100, 100]) : null;
    };

    PenFX.prototype.displacementMap = function (args, util) {
        const typeKey = String(args.TYPE);
        const channelKey = String(args.CHANNEL);
        const type = TYPE_NAMES.includes(typeKey) ? typeKey : 'x';
        const channel = CHANNEL_NAMES.includes(channelKey) ? channelKey : 'luminance';
        this._safe(engine => engine.displacement(args.COSTUME, number(args.VALUE), type, channel,
            boolean(args.INVERT), numberOr(args.CENTER, 0.5), mixAmount(args.MIX), util.target, this.blendMode));
    };
};

export default install;
