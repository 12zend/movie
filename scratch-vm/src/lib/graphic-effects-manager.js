import * as twgl from 'twgl.js';
import compatBlocks from '../compiler/compat-blocks';

import spriteVertexShader from '!raw-loader!./graphic-effects.vert';
import spriteFragmentShader from '!raw-loader!./graphic-effects.frag';
import {ADVANCED_GRAPHIC_BLOCKS} from './project-format';

const EFFECT_NAMES = [
    'gaussianblur',
    'lensblur',
    'radialblur',
    'directionalblur',
    'turbulentdisplace',
    'posterize',
    'rgbshift',
    'edgedetection',
    'circularripple',
    'pixelstretch',
    'bloom',
    'displacementmap',
    'effectweight'
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const number = value => {
    const result = Number(value);
    return Number.isFinite(result) ? result : 0;
};
const radians = value => number(value) * Math.PI / 180;
const vector = (value, length) => (
    Array.isArray(value) ? value.slice(0, length) : new Array(length).fill(0)
);
const PADDING_SAFETY = 2;

const growPadding = (padding, x, y = x) => {
    if (x > 0) padding[0] = Math.max(padding[0], Math.ceil(x) + PADDING_SAFETY);
    if (y > 0) padding[1] = Math.max(padding[1], Math.ceil(y) + PADDING_SAFETY);
};

const EFFECT_INFO = {
    gaussianblur: {
        uniformName: 'u_gaussianBlur',
        mask: 1 << 7,
        converter: value => clamp(Math.abs(number(value)), 0, 48),
        shapeChanges: true
    },
    lensblur: {
        uniformName: 'u_lensBlur',
        mask: 1 << 8,
        converter: value => clamp(Math.abs(number(value)), 0, 48),
        shapeChanges: true
    },
    radialblur: {
        uniformName: 'u_radialBlur',
        mask: 1 << 9,
        converter: value => clamp(Math.abs(number(value)) / 100, 0, 1),
        shapeChanges: true
    },
    directionalblur: {
        uniformName: 'u_directionalBlur',
        mask: 1 << 10,
        converter: value => clamp(Math.abs(number(value)), 0, 48),
        shapeChanges: true
    },
    turbulentdisplace: {
        uniformName: 'u_turbulentDisplace',
        mask: 1 << 11,
        converter: value => vector(value, 4),
        shapeChanges: true
    },
    posterize: {
        uniformName: 'u_posterize',
        mask: 1 << 12,
        converter: value => clamp(Math.round(Math.abs(number(value))), 2, 64),
        shapeChanges: false
    },
    rgbshift: {
        uniformName: 'u_rgbShift',
        mask: 1 << 13,
        converter: value => vector(value, 2),
        shapeChanges: false
    },
    edgedetection: {
        uniformName: 'u_edgeDetection',
        mask: 1 << 14,
        converter: value => clamp(Math.abs(number(value)) / 100, 0, 4),
        shapeChanges: false
    },
    circularripple: {
        uniformName: 'u_circularRipple',
        mask: 1 << 15,
        converter: value => vector(value, 3),
        shapeChanges: true
    },
    pixelstretch: {
        uniformName: 'u_pixelStretchA',
        mask: 1 << 16,
        converter: value => vector(value, 4),
        shapeChanges: true
    },
    bloom: {
        uniformName: 'u_bloom',
        mask: 1 << 17,
        converter: value => vector(value, 3),
        shapeChanges: false
    },
    displacementmap: {
        uniformName: 'u_displacement',
        mask: 1 << 18,
        converter: value => vector(value, 2),
        shapeChanges: true
    },
    effectweight: {
        uniformName: 'u_effectWeightAmount',
        mask: 1 << 19,
        converter: value => number(value),
        shapeChanges: false
    }
};

const calculateEffectPadding = drawable => {
    if (!drawable || !drawable.skin) return [0, 0];
    const uniforms = drawable._uniforms;
    const padding = [0, 0];
    const enabled = effectName => (
        (drawable.enabledEffects & EFFECT_INFO[effectName].mask) !== 0
    );

    if (enabled('gaussianblur')) growPadding(padding, uniforms.u_gaussianBlur);
    if (enabled('lensblur')) growPadding(padding, uniforms.u_lensBlur);
    if (enabled('directionalblur')) growPadding(padding, uniforms.u_directionalBlur, 0);
    if (enabled('bloom')) growPadding(padding, Math.abs(uniforms.u_bloom[1]));

    if (enabled('rgbshift')) {
        const amount = Math.abs(uniforms.u_rgbShift[0]);
        const angle = uniforms.u_rgbShift[1];
        growPadding(padding, amount * Math.abs(Math.cos(angle)), amount * Math.abs(Math.sin(angle)));
    }
    if (enabled('turbulentdisplace')) {
        growPadding(padding, Math.abs(uniforms.u_turbulentDisplace[0]) * 0.5);
    }
    if (enabled('circularripple')) {
        growPadding(padding, Math.abs(uniforms.u_circularRipple[1]));
    }
    if (enabled('pixelstretch')) {
        const amount = Math.abs(uniforms.u_pixelStretchA[0]);
        const angle = uniforms.u_pixelStretchB[2];
        growPadding(padding, amount * Math.abs(Math.cos(angle)), amount * Math.abs(Math.sin(angle)));
    }
    if (enabled('displacementmap')) {
        const type = uniforms.u_displacement[0];
        const amount = Math.abs(uniforms.u_displacement[1]) * 0.5;
        if (type < 0.5) growPadding(padding, amount, 0);
        else if (type < 1.5) growPadding(padding, 0, amount);
        else growPadding(padding, amount);
    }
    if (enabled('radialblur')) {
        const amount = uniforms.u_radialBlur;
        growPadding(
            padding,
            drawable.skin.size[0] * amount * 0.3,
            drawable.skin.size[1] * amount * 0.3
        );
    }
    return padding;
};

const expandBoundsForEffectPadding = (drawable, bounds) => {
    const padding = drawable._uniforms.u_effectPadding;
    if (!padding || (padding[0] === 0 && padding[1] === 0) || !drawable.skin) return bounds;
    const matrix = drawable._uniforms.u_modelMatrix;
    const skinSize = drawable.skin.size;
    const width = Math.max(skinSize[0], 1);
    const height = Math.max(skinSize[1], 1);
    const x = (Math.abs(matrix[0] * padding[0] / width)) +
        (Math.abs(matrix[4] * padding[1] / height));
    const y = (Math.abs(matrix[1] * padding[0] / width)) +
        (Math.abs(matrix[5] * padding[1] / height));
    bounds.left -= x;
    bounds.right += x;
    bounds.bottom -= y;
    bounds.top += y;
    return bounds;
};

/* eslint-disable no-invalid-this */
const buildShader = function (drawMode, effectBits) {
    const defines = [`#define DRAW_MODE_${drawMode}`];
    for (let index = 0; index < this.constructor.EFFECTS.length; index++) {
        if ((effectBits & (1 << index)) !== 0) {
            defines.push(`#define ENABLE_${this.constructor.EFFECTS[index]}`);
        }
    }
    const definesText = `${defines.join('\n')}\n`;
    let errorMessage = null;
    const onError = error => {
        // eslint-disable-next-line no-console
        console.error(error);
        const match = error.match(/\*\*\* Error compiling shader: ([\s\S]+)/);
        errorMessage = match ? match[1].trim() : error;
    };
    const program = twgl.createProgramInfo(
        this._gl,
        [definesText + spriteVertexShader, definesText + spriteFragmentShader],
        null,
        null,
        onError
    );
    if (!program) {
        throw new Error(`Failed to compile shader (mode ${drawMode}, effects ${effectBits}): ${errorMessage}`);
    }
    return program;
};
/* eslint-enable no-invalid-this */

const initializeDrawable = drawable => {
    if (!drawable) return;
    for (const effectName of EFFECT_NAMES) {
        const effectInfo = EFFECT_INFO[effectName];
        if (!Object.prototype.hasOwnProperty.call(drawable._uniforms, effectInfo.uniformName)) {
            drawable._uniforms[effectInfo.uniformName] = effectInfo.converter(0);
        }
    }
    if (!Object.prototype.hasOwnProperty.call(drawable._uniforms, 'u_rgbShiftColor')) {
        drawable._uniforms.u_rgbShiftColor = 0;
        drawable._uniforms.u_pixelStretchB = [0, 0, 0, 0];
    }
    if (!Object.prototype.hasOwnProperty.call(drawable._uniforms, 'u_effectPadding')) {
        drawable._uniforms.u_effectPadding = [0, 0];
    }
    if (!drawable.__movieEffectBoundsPatched) {
        drawable.__movieEffectBoundsPatched = true;
        const originalGetAABB = drawable.getAABB.bind(drawable);
        const originalGetBounds = drawable.getBounds.bind(drawable);
        drawable.getAABB = result => expandBoundsForEffectPadding(drawable, originalGetAABB(result));
        drawable.getBounds = result => expandBoundsForEffectPadding(drawable, originalGetBounds(result));
    }
};

const installRendererEffects = renderer => {
    if (!renderer || !renderer._shaderManager) return;
    const ShaderManager = renderer._shaderManager.constructor;
    if (!ShaderManager.__movieGraphicEffects) {
        Object.assign(ShaderManager.EFFECT_INFO, EFFECT_INFO);
        ShaderManager.EFFECTS = Object.keys(ShaderManager.EFFECT_INFO);
        ShaderManager.prototype._buildShader = buildShader;
        ShaderManager.__movieGraphicEffects = true;
    }
    renderer._shaderManager._shaderCache = {};
    for (const drawMode in ShaderManager.DRAW_MODE) {
        if (!Object.prototype.hasOwnProperty.call(ShaderManager.DRAW_MODE, drawMode)) continue;
        renderer._shaderManager._shaderCache[ShaderManager.DRAW_MODE[drawMode]] = [];
    }
    renderer._allDrawables.forEach(initializeDrawable);
};

const defaultTargetState = () => ({
    displacementCostume: null,
    effectWeightCostume: null,
    height: 100,
    pixelStretchB: [0, 0, 0, 0],
    rgbShiftColor: 0,
    width: 100
});

class GraphicEffectsManager {
    constructor (vm) {
        this.vm = vm;
        this.runtime = vm.runtime;
        this.targetStates = new Map();
        this.handleTargetCreated = this.handleTargetCreated.bind(this);
        this.handleTargetRemoved = this.handleTargetRemoved.bind(this);

        installRendererEffects(this.runtime.renderer);
        this.runtime.on('targetWasCreated', this.handleTargetCreated);
        this.runtime.on('targetWasRemoved', this.handleTargetRemoved);
        this.runtime.targets.forEach(target => this.patchTarget(target));
        this.installPrimitives();
    }

    installPrimitives () {
        const primitives = this.runtime._primitives;
        primitives.looks_setwidthto = (args, util) => this.setScale(util.target, 'width', args.WIDTH);
        primitives.looks_setheightto = (args, util) => this.setScale(util.target, 'height', args.HEIGHT);
        primitives.looks_turbulentdisplace = (args, util) => this.turbulentDisplace(util.target, args);
        primitives.looks_posterize = (args, util) => this.posterize(util.target, args.VALUE);
        primitives.looks_rgbshift = (args, util) => this.rgbShift(util.target, args);
        primitives.looks_edgedetection = (args, util) => this.edgeDetection(util.target, args.VALUE);
        primitives.looks_circularripple = (args, util) => this.circularRipple(util.target, args);
        primitives.looks_pixelstretch = (args, util) => this.pixelStretch(util.target, args);
        primitives.looks_bloom = (args, util) => this.bloom(util.target, args);
        primitives.looks_displacementmap = (args, util) => this.displacementMap(util.target, args);
        primitives.looks_effectweight = (args, util) => this.effectWeight(util.target, args.COSTUME);

        for (const opcode of ADVANCED_GRAPHIC_BLOCKS) {
            if (!compatBlocks.stacked.includes(opcode)) compatBlocks.stacked.push(opcode);
        }
    }

    handleTargetCreated (target, sourceTarget) {
        this.patchTarget(target, sourceTarget);
    }

    handleTargetRemoved (target) {
        this.targetStates.delete(target.id);
    }

    patchTarget (target, sourceTarget) {
        if (!target || target.__movieGraphicEffectsPatched) return;
        target.__movieGraphicEffectsPatched = true;

        const sourceState = sourceTarget && this.targetStates.get(sourceTarget.id);
        const state = sourceState ? JSON.parse(JSON.stringify(sourceState)) : defaultTargetState();
        this.targetStates.set(target.id, state);

        for (const effectName of EFFECT_NAMES) {
            if (!Object.prototype.hasOwnProperty.call(target.effects, effectName)) target.effects[effectName] = 0;
        }

        const originalRenderedScale = target._getRenderedDirectionAndScale.bind(target);
        target._getRenderedDirectionAndScale = () => {
            const rendered = originalRenderedScale();
            const currentState = this.targetStates.get(target.id) || defaultTargetState();
            rendered.scale = [
                rendered.scale[0] * currentState.width / 100,
                rendered.scale[1] * currentState.height / 100
            ];
            return rendered;
        };

        const originalUpdateAll = target.updateAllDrawableProperties.bind(target);
        target.updateAllDrawableProperties = () => {
            const result = originalUpdateAll();
            this.restoreExtraUniforms(target);
            return result;
        };

        const originalSetEffect = target.setEffect.bind(target);
        target.setEffect = (effectName, value) => {
            const result = originalSetEffect(effectName, value);
            this.updateEffectPadding(target);
            return result;
        };

        const originalClearEffects = target.clearEffects.bind(target);
        target.clearEffects = () => {
            const result = originalClearEffects();
            this.updateEffectPadding(target);
            return result;
        };

        this.restoreExtraUniforms(target);
    }

    getDrawable (target) {
        const renderer = this.runtime.renderer;
        const drawable = renderer && renderer._allDrawables[target.drawableID];
        initializeDrawable(drawable);
        return drawable;
    }

    updateExtraUniforms (target, uniforms) {
        const drawable = this.getDrawable(target);
        if (drawable) Object.assign(drawable._uniforms, uniforms);
    }

    updateEffectPadding (target) {
        const drawable = this.getDrawable(target);
        if (!drawable) return;
        drawable._uniforms.u_effectPadding = calculateEffectPadding(drawable);
        drawable.setConvexHullDirty();
    }

    resolveCostume (target, requestedCostume) {
        const costumes = target.getCostumes();
        if (!costumes.length) return null;
        if (typeof requestedCostume === 'number' || /^\s*[+-]?\d+(?:\.\d+)?\s*$/.test(String(requestedCostume))) {
            const index = clamp(Math.round(number(requestedCostume)) - 1, 0, costumes.length - 1);
            return costumes[index];
        }
        return costumes.find(costume => costume.name === String(requestedCostume)) || costumes[target.currentCostume];
    }

    getCostumeTexture (target, requestedCostume) {
        const costume = this.resolveCostume(target, requestedCostume);
        const renderer = this.runtime.renderer;
        if (!costume || !renderer) return null;
        const skin = renderer._allSkins[costume.skinId];
        return skin ? skin.getTexture([100, 100]) : null;
    }

    getTargetState (target) {
        let state = this.targetStates.get(target.id);
        if (!state) {
            // Targets normally receive a state when patched, but an effect opcode can run before
            // patchTarget fires (for example during deserialization). Recover instead of crashing.
            state = defaultTargetState();
            this.targetStates.set(target.id, state);
        }
        return state;
    }

    restoreExtraUniforms (target) {
        const state = this.targetStates.get(target.id);
        if (!state) return;
        const uniforms = {
            u_pixelStretchB: state.pixelStretchB,
            u_rgbShiftColor: state.rgbShiftColor
        };
        if (state.displacementCostume !== null) {
            uniforms.u_displacementMap = this.getCostumeTexture(target, state.displacementCostume);
        }
        if (state.effectWeightCostume !== null) {
            uniforms.u_effectWeight = this.getCostumeTexture(target, state.effectWeightCostume);
        }
        this.updateExtraUniforms(target, uniforms);
        this.updateEffectPadding(target);
    }

    setScale (target, axis, value) {
        const state = this.targetStates.get(target.id);
        if (!state || target.isStage) return;
        state[axis] = number(value);
        const {direction, scale} = target._getRenderedDirectionAndScale();
        if (this.runtime.renderer) {
            this.runtime.renderer.updateDrawableDirectionScale(target.drawableID, direction, scale);
        }
        if (target.visible) {
            target.emitVisualChange();
            this.runtime.requestRedraw();
        }
        this.runtime.requestTargetsUpdate(target);
    }

    turbulentDisplace (target, args) {
        const amount = clamp(number(args.AMOUNT), -100, 100);
        const value = [
            amount,
            clamp(Math.abs(number(args.SIZE)), 1, 1000),
            clamp(Math.round(Math.abs(number(args.COMPLEXITY))), 1, 5),
            radians(args.EVOLUTION)
        ];
        target.setEffect('turbulentdisplace', amount === 0 ? 0 : value);
    }

    posterize (target, value) {
        const levels = number(value);
        target.setEffect('posterize', levels === 0 ? 0 : levels);
    }

    rgbShift (target, args) {
        const amount = clamp(number(args.VALUE), -100, 100);
        const colorCodes = {RG: 0, GB: 1, BR: 2};
        const state = this.getTargetState(target);
        state.rgbShiftColor = colorCodes[args.COLOR] || 0;
        this.updateExtraUniforms(target, {u_rgbShiftColor: state.rgbShiftColor});
        target.setEffect('rgbshift', amount === 0 ? 0 : [amount, radians(args.DIR)]);
    }

    edgeDetection (target, value) {
        const amount = number(value);
        target.setEffect('edgedetection', amount === 0 ? 0 : amount);
    }

    circularRipple (target, args) {
        const amount = clamp(number(args.VALUE), -100, 100);
        target.setEffect('circularripple', amount === 0 ? 0 : [
            clamp(Math.abs(number(args.FREQUENCY)), 0, 100),
            amount,
            radians(args.OFFSET)
        ]);
    }

    pixelStretch (target, args) {
        const offset = clamp(number(args.OFFSET), -200, 200);
        const state = this.getTargetState(target);
        state.pixelStretchB = [
            clamp(number(args.X) / 100, -2, 2),
            clamp(number(args.Y) / 100, -2, 2),
            radians(args.ANGLE),
            0
        ];
        this.updateExtraUniforms(target, {u_pixelStretchB: state.pixelStretchB});
        target.setEffect('pixelstretch', offset === 0 ? 0 : [
            offset,
            clamp(Math.abs(number(args.SMOOTHNESS)) / 100, 0, 1),
            clamp(Math.abs(number(args.FALLOFF)) / 100, 0, 4),
            clamp(Math.abs(number(args.RADIUS)) / 100, 0.001, 4)
        ]);
    }

    bloom (target, args) {
        const value = clamp(number(args.VALUE), -400, 400);
        target.setEffect('bloom', value === 0 ? 0 : [
            clamp(number(args.THRESHOLD) / 100, 0, 1),
            clamp(Math.abs(number(args.BLUR)), 0, 64),
            value / 100
        ]);
    }

    displacementMap (target, args) {
        const typeCodes = {x: 0, y: 1, size: 2, dir: 3};
        const value = clamp(number(args.VALUE), -360, 360);
        const state = this.getTargetState(target);
        state.displacementCostume = String(args.COSTUME);
        const texture = this.getCostumeTexture(target, args.COSTUME);
        this.updateExtraUniforms(target, {u_displacementMap: texture});
        target.setEffect('displacementmap', !texture || value === 0 ? 0 : [typeCodes[args.TYPE] || 0, value]);
    }

    effectWeight (target, requestedCostume) {
        const state = this.getTargetState(target);
        state.effectWeightCostume = String(requestedCostume);
        const texture = this.getCostumeTexture(target, requestedCostume);
        this.updateExtraUniforms(target, {u_effectWeight: texture});
        target.setEffect('effectweight', texture ? 1 : 0);
    }
}

const installGraphicEffectsManager = vm => {
    if (!vm.__graphicEffectsManager) {
        vm.__graphicEffectsManager = new GraphicEffectsManager(vm);
        vm.runtime.graphicEffectsManager = vm.__graphicEffectsManager;
    }
    return vm.__graphicEffectsManager;
};

export {installGraphicEffectsManager as default};
