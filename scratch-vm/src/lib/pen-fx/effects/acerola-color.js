/* eslint-disable */

import {boolean, color, mixAmount, number, numberOr} from '../helpers';

const CHROMA_KEY_BEHAVIORS = ['solid', 'gradient', 'transparent'];
const COLOR_BLINDNESS_TYPES = ['deuteranopia', 'protanopia', 'tritanopia'];
const TONE_MAP_TYPES = ['clamp', 'aces hill', 'aces', 'reinhard'];

const install = ({Engine, PenFX}) => {
    Engine.prototype.alpha = function (value, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 0, {u_value: value, u_mix: mixValue}, [], blendMode);
    };

    Engine.prototype.chromaKey = function (keyColor, tolerance, softness, behavior, replacement, gradientEnd, mixValue, blendMode) {
        const behaviorIndex = CHROMA_KEY_BEHAVIORS.indexOf(behavior);
        this._acerolaPass(this._program('acerolaColor'), 1, {
            u_type: Math.max(0, behaviorIndex),
            u_value: tolerance,
            u_value2: softness,
            u_color: keyColor,
            u_color2: replacement,
            u_color3: gradientEnd,
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.colorBlindness = function (type, severity, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 2, {
            u_type: Math.max(0, COLOR_BLINDNESS_TYPES.indexOf(type)),
            u_value: severity,
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.colorGrade = function (exposure, temperature, tint, contrast, pivot, filter, saturation, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 3, {
            u_value: exposure,
            u_value2: temperature,
            u_value3: tint,
            u_vec: [pivot, contrast],
            u_color: filter,
            u_color2: [saturation, 0, 0],
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.dither = function (redCount, greenCount, blueCount, spread, scale, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 4, {
            u_vec: [redCount, greenCount],
            u_value: blueCount,
            u_value2: spread,
            u_value3: scale,
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.filmGrain = function (intensity, response, size, animate, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 5, {
            u_value: intensity,
            u_value2: response,
            u_value3: size,
            u_time: animate ? performance.now() / 1000 : 0,
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.toneMap = function (type, exposure, whitePoint, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 6, {
            u_type: Math.max(0, TONE_MAP_TYPES.indexOf(type)),
            u_value: exposure,
            u_value2: whitePoint,
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.vignette = function (vignetteColor, sizeX, sizeY, offsetX, offsetY, intensity, roundness, softness, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 7, {
            u_vec: [sizeX, sizeY],
            u_vec2: [offsetX, offsetY],
            u_value: intensity,
            u_value2: roundness,
            u_value3: softness,
            u_color: vignetteColor,
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.composition = function (divisions, width, opacity, lineColor, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 8, {
            u_type: Math.min(12, Math.max(2, Math.round(divisions))),
            u_value: width,
            u_value2: opacity,
            u_color: lineColor,
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.halftone = function (size, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 9, {
            u_value: Math.max(1, size), u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.crt = function (curvature, border, scanSize, scanStrength, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 10, {
            u_value: curvature,
            u_value2: border,
            u_value3: scanSize,
            u_vec: [scanStrength, 0],
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.paletteSwap = function (colors, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 11, {
            u_color: colors[0],
            u_color2: colors[1],
            u_color3: colors[2],
            u_color4: colors[3],
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.colorSpaceAdjust = function (hueAdd, hueMultiply, saturationAdd, saturationMultiply, lightnessAdd, lightnessMultiply, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 12, {
            u_value: hueAdd,
            u_value2: hueMultiply,
            u_vec: [saturationAdd, saturationMultiply],
            u_vec2: [lightnessAdd, lightnessMultiply],
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.ascii = function (cellWidth, cellHeight, foreground, background, invert, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 13, {
            u_type: invert ? 1 : 0,
            u_vec: [cellWidth, cellHeight],
            u_color: foreground,
            u_color2: background,
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.framing = function (shape, radius, softness, frameColor, opacity, offsetX, offsetY, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 14, {
            u_type: shape === 'circle' ? 1 : 0,
            u_value: radius,
            u_value2: softness,
            u_value3: opacity,
            u_vec2: [offsetX, offsetY],
            u_color: frameColor,
            u_mix: mixValue
        }, [], blendMode);
    };

    Engine.prototype.autoExposure = function (target, minimum, maximum, mixValue, blendMode) {
        this._acerolaPass(this._program('acerolaColor'), 15, {
            u_value: target, u_value2: minimum, u_value3: maximum, u_mix: mixValue
        }, [], blendMode);
    };

    PenFX.prototype.alpha = function (args) {
        this._safe(engine => engine.alpha(numberOr(args.VALUE, 100) / 100, mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.colorGrade = function (args) {
        this._safe(engine => engine.colorGrade(number(args.EXPOSURE), number(args.TEMP), number(args.TINT),
            numberOr(args.CONTRAST, 1), numberOr(args.PIVOT, 0.5), color(args.COLOR || '#ffffff'),
            number(args.SATURATION), mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.colorBlindness = function (args) {
        const requested = String(args.TYPE);
        const type = COLOR_BLINDNESS_TYPES.includes(requested) ? requested : 'deuteranopia';
        this._safe(engine => engine.colorBlindness(type, Math.min(1, Math.max(0, number(args.SEVERITY) / 100)), mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.colorSpaceAdjust = function (args) {
        const hueAdd = number(args.HADD);
        const hueMultiply = numberOr(args.HMUL, 1);
        const saturationAdd = number(args.SADD);
        const saturationMultiply = numberOr(args.SMUL, 1);
        const lightnessAdd = number(args.LADD);
        const lightnessMultiply = numberOr(args.LMUL, 1);
        const mixValue = mixAmount(args.MIX);
        this._safe(engine => engine.colorSpaceAdjust(hueAdd, hueMultiply, saturationAdd, saturationMultiply,
            lightnessAdd, lightnessMultiply, mixValue, this.blendMode));
    };

    PenFX.prototype.toneMap = function (args) {
        const requested = String(args.TYPE);
        const type = TONE_MAP_TYPES.includes(requested) ? requested : 'aces';
        this._safe(engine => engine.toneMap(type, number(args.EXPOSURE), numberOr(args.WHITE, 4), mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.autoExposure = function (args) {
        const minimum = Math.max(0, numberOr(args.MIN, 0.25));
        const maximum = Math.max(minimum, numberOr(args.MAX, 4));
        this._safe(engine => engine.autoExposure(Math.max(0.001, numberOr(args.TARGET, 0.18)), minimum, maximum, mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.paletteSwap = function (args) {
        this._safe(engine => engine.paletteSwap([color(args.C1), color(args.C2), color(args.C3), color(args.C4)], mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.chromaKey = function (args) {
        const requested = String(args.BEHAVIOR);
        const behavior = CHROMA_KEY_BEHAVIORS.includes(requested) ? requested : 'solid';
        this._safe(engine => engine.chromaKey(color(args.KEY), Math.max(0, number(args.TOLERANCE)),
            Math.max(0.0001, numberOr(args.SOFTNESS, 0.05)), behavior, color(args.COLOR1), color(args.COLOR2),
            mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.vignette = function (args) {
        this._safe(engine => engine.vignette(color(args.COLOR), numberOr(args.X, 1), numberOr(args.Y, 1),
            number(args.OFFSETX), number(args.OFFSETY), numberOr(args.INTENSITY, 1), numberOr(args.ROUNDNESS, 1),
            numberOr(args.SOFTNESS, 1), mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.composition = function (args) {
        this._safe(engine => engine.composition(numberOr(args.DIVISIONS, 3), numberOr(args.WIDTH, 1),
            Math.min(1, Math.max(0, numberOr(args.OPACITY, 50) / 100)), color(args.COLOR), mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.filmGrain = function (args) {
        this._safe(engine => engine.filmGrain(numberOr(args.INTENSITY, 0.15), numberOr(args.RESPONSE, 0.15),
            numberOr(args.SIZE, 1), boolean(args.ANIMATE), mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.dither = function (args) {
        this._safe(engine => engine.dither(Math.min(32, Math.max(2, numberOr(args.R, 4))),
            Math.min(32, Math.max(2, numberOr(args.G, 4))), Math.min(32, Math.max(2, numberOr(args.B, 4))),
            numberOr(args.SPREAD, 0.5), Math.max(1, numberOr(args.SCALE, 1)), mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.halftone = function (args) {
        this._safe(engine => engine.halftone(numberOr(args.SIZE, 4), mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.ascii = function (args) {
        this._safe(engine => engine.ascii(Math.max(2, numberOr(args.X, 6)), Math.max(2, numberOr(args.Y, 8)),
            color(args.FG), color(args.BG), boolean(args.INVERT), mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.crt = function (args) {
        this._safe(engine => engine.crt(Math.max(1, numberOr(args.CURVATURE, 10)), Math.max(0.001, numberOr(args.BORDER, 0.08)),
            Math.max(1, numberOr(args.SIZE, 2)), Math.min(1, Math.max(0, numberOr(args.STRENGTH, 0.35))),
            mixAmount(args.MIX), this.blendMode));
    };

    PenFX.prototype.framing = function (args) {
        this._safe(engine => engine.framing(String(args.SHAPE) === 'circle' ? 'circle' : 'rectangle',
            numberOr(args.RADIUS, 0.45), numberOr(args.SOFTNESS, 0.02), color(args.COLOR),
            Math.min(1, Math.max(0, numberOr(args.OPACITY, 100) / 100)), number(args.X), number(args.Y),
            mixAmount(args.MIX), this.blendMode));
    };
};

export default install;
