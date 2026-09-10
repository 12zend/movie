/* eslint-disable */

import createPenFXEngine from './engine';
import installEffects from './effects';
import PenFXCustomShaderManager from './custom-shaders';
import {BLEND_MODES} from './constants';
import {mixAmount} from './helpers';

const createPenFXClass = vm => {
    const renderer = vm.runtime.renderer;
    const gl = renderer._gl || renderer.gl;
    const PenFXEngine = createPenFXEngine(gl, renderer);

    class PenFX {
        constructor() {
            this.engine = null;
            this.blendMode = 'normal';
            this.blendOpacity = 1;
            this.warned = false;
            this.effectCaptureStack = [];
            this.groupEffectScope = null;
            this.shaderProgramOverrides = null;
            vm.runtime.penFX = this;
            this.customShaders = new PenFXCustomShaderManager(vm, this, {loadDefaultPackage: true});
            const movieAssetManager = vm.runtime.movieAssetManager;
            if (movieAssetManager && typeof movieAssetManager.attachPenFrameTransactions === 'function') {
                movieAssetManager.attachPenFrameTransactions(this);
            }
        }

        getInfo() {
            return {
                id: 'penfx',
                name: 'エフェクト',
                color1: '#6b56d9',
                color2: '#5945c2',
                color3: '#46359f',
                blocks: this.customShaders.getToolboxBlocks(),
                menus: this.customShaders.getMenus()
            };
        }

        _getEngine() {
            if (!this.engine) {
                this.engine = new PenFXEngine();
                this.customShaders.installIntoEngine(this.engine);
            }
            return this.engine;
        }

        importShaderPackage() {
            this.customShaders.openImportPicker();
        }

        _executeSafe(callback, blendMode, blendOpacity, renderContext = null, effect = null) {
            const previousBlendMode = this.blendMode;
            const previousBlendOpacity = this.blendOpacity;
            let engine;
            let previousGroupEffectScope;
            try {
                this.blendMode = blendMode;
                this.blendOpacity = blendOpacity;
                engine = this._getEngine();
                previousGroupEffectScope = engine.groupEffectScope;
                engine.groupEffectScope = effect && effect.groupEffectScope === 'expanded' ? 'expanded' : null;
                engine.blendOpacity = this.blendOpacity;
                callback(engine, renderContext);
            } catch (error) {
                console.error('[Pen FX]', error);
            } finally {
                // _prepare disables blending before compiling the selected program. If compilation or rendering fails,
                // leaving that state active makes the transparent Pen framebuffer cover the stage as opaque black.
                if (engine) {
                    engine.groupEffectScope = previousGroupEffectScope;
                    if (typeof engine._restoreGLState === 'function') engine._restoreGLState();
                }
                this.blendMode = previousBlendMode;
                this.blendOpacity = previousBlendOpacity;
            }
        }

        _getEffectRenderContext(effect) {
            const movieAssetManager = vm.runtime.movieAssetManager;
            const depth = movieAssetManager && typeof movieAssetManager.getDepthResource === 'function' ?
                movieAssetManager.getDepthResource(effect && effect.targetId) : null;
            return {
                resources: {depth},
                targetId: effect && effect.targetId || null
            };
        }

        _safe(callback, options = {}) {
            const programOverrides = this.shaderProgramOverrides;
            if (programOverrides) {
                const effectCallback = callback;
                callback = (engine, renderContext) => engine.withProgramOverrides(
                    programOverrides,
                    () => effectCallback(engine, renderContext)
                );
            }
            const effectData = {
                blendMode: this.blendMode,
                blendOpacity: this.blendOpacity,
                callback,
                targetId: options.target && options.target.id || null
            };
            if (options.groupEffectScope === 'expanded' || this.groupEffectScope === 'expanded') {
                effectData.groupEffectScope = 'expanded';
            }
            const effect = Object.freeze(effectData);
            if (this.effectCaptureStack.length) {
                this.effectCaptureStack[this.effectCaptureStack.length - 1].push(effect);
                return;
            }
            const movieAssetManager = vm.runtime.movieAssetManager;
            if (movieAssetManager && typeof movieAssetManager.enqueueFrameGraphEffect === 'function' &&
                movieAssetManager.enqueueFrameGraphEffect(effect)) return;
            this._executeSafe(
                effect.callback,
                effect.blendMode,
                effect.blendOpacity,
                this._getEffectRenderContext(effect),
                effect
            );
        }

        withShaderProgramOverrides(overrides, callback) {
            const previous = this.shaderProgramOverrides;
            this.shaderProgramOverrides = overrides;
            try {
                return callback();
            } finally {
                this.shaderProgramOverrides = previous;
            }
        }

        withGroupEffectScope(scope, callback) {
            const previous = this.groupEffectScope;
            this.groupEffectScope = scope === 'expanded' ? 'expanded' : null;
            try {
                return callback();
            } finally {
                this.groupEffectScope = previous;
            }
        }

        beginEffectCapture() {
            this.effectCaptureStack.push([]);
        }

        endEffectCapture() {
            return this.effectCaptureStack.pop() || [];
        }

        applyCapturedEffects(effects, renderContext = null) {
            for (const effect of effects || []) {
                this._executeSafe(
                    effect.callback,
                    effect.blendMode,
                    effect.blendOpacity,
                    renderContext || this._getEffectRenderContext(effect),
                    effect
                );
            }
        }

        beginGroup() { this._safe(engine => engine.beginGroup()); }
        endGroup(options) { this._safe(engine => engine.endGroup(options)); }
        drawRenderPass(name, options) { this._safe(engine => engine.drawRenderPass(name, options)); }
        clearRenderPass(name) {
            if (!this.engine) return;
            this._safe(engine => engine.clearRenderPass(name));
        }
        clearRenderPasses() {
            if (!this.engine) return;
            this._safe(engine => engine.clearRenderPasses());
        }

        beginMatte() {
            try {
                return this._getEngine().beginMatte();
            } catch (error) {
                console.error('[Pen FX]', error);
                return false;
            }
        }

        beginMatteMask() {
            try {
                return this._getEngine().beginMatteMask();
            } catch (error) {
                console.error('[Pen FX]', error);
                return false;
            }
        }

        endMatte(options) {
            try {
                return this._getEngine().endMatte(options);
            } catch (error) {
                console.error('[Pen FX]', error);
                return false;
            }
        }

        beginFrame() {
            try {
                return this._getEngine().beginFrame();
            } catch (error) {
                console.error('[Pen FX]', error);
                return false;
            }
        }

        commitFrame() {
            try {
                return this._getEngine().commitFrame();
            } catch (error) {
                console.error('[Pen FX]', error);
                return false;
            }
        }

        cancelFrame() {
            try {
                return this._getEngine().cancelFrame();
            } catch (error) {
                console.error('[Pen FX]', error);
                return false;
            }
        }

        cancelGroups() {
            this.effectCaptureStack.length = 0;
            if (!this.engine) return;
            try {
                this.engine.clearGroupStack();
                this.engine.clearMatteStack();
                this.engine._restoreGLState();
            } catch (error) {
                console.error('[Pen FX]', error);
            }
        }

        drawDefaultBackground(color4f) {
            const pen = vm.runtime.ext_pen;
            if (pen && typeof pen._getPenLayerID === 'function') pen._getPenLayerID();
            try {
                this._getEngine().drawDefaultBackground(color4f);
            } catch (error) {
                console.error('[Pen FX]', error);
            }
        }

        setBlendMode(args) {
            const mode = String(args.TYPE);
            this.blendMode = BLEND_MODES.includes(mode) ? mode : 'normal';
            this.blendOpacity = mixAmount(args.OPACITY);
        }
    }

    installEffects({Engine: PenFXEngine, PenFX, vm});
    return PenFX;
};

const installPenFX = vm => {
    const extensionManager = vm.extensionManager;
    if (extensionManager.isExtensionLoaded('penfx')) return vm;

    const PenFX = createPenFXClass(vm);
    extensionManager.addBuiltinExtension('penfx', PenFX);
    extensionManager.loadExtensionIdSync('penfx');
    return vm;
};

export {createPenFXClass};
export default installPenFX;
