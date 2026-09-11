/* eslint-disable */

import {boolean, numberOr} from '../helpers';

// Shared lookup tables. Treated as read-only by consumers (_render only reads
// samplers/integerUniforms), so every invocation can reference the same
// instances instead of allocating fresh literals per block execution.
const STACK_MODES = ['average', 'add', 'lighten', 'darken'];
const STACK_INTEGER_UNIFORMS = ['u_mode', 'u_first'];
const EMPTY_UNIFORMS = {};
const EMPTY_INTEGER_UNIFORMS = [];

const install = ({Engine, PenFX}) => {
    Engine.prototype.stackCurrent = function (weight, limit) {
        const gl = this.gl;
        const skin = this._prepare(false, false);
        if (!skin) return;
        const safeLimit = Math.min(120, Math.max(1, Math.floor(limit)));
        const bufferStack = this.bufferStack;
        while (bufferStack.length > safeLimit) {
            const removed = bufferStack.shift();
            gl.deleteFramebuffer(removed.framebuffer);
            gl.deleteTexture(removed.texture);
        }
        const entry = bufferStack.length === safeLimit ?
            bufferStack.shift() : this._createBufferTexture();
        entry.weight = Math.max(0.0001, weight);
        this._render(this._program('copy'), entry.framebuffer, [{name: 'u_image', texture: skin._texture}], EMPTY_UNIFORMS, EMPTY_INTEGER_UNIFORMS);
        bufferStack.push(entry);
        this._restoreGLState();
    };

    Engine.prototype.renderBufferStack = function (mode, clearAfter) {
        const bufferStack = this.bufferStack;
        if (bufferStack.length === 0) return;
        const skin = this._prepare(false, false);
        if (!skin) return;
        if (bufferStack.length === 0) {
            this._restoreGLState();
            return;
        }
        const modeIndex = STACK_MODES.indexOf(mode);
        const clampedModeIndex = Math.max(0, modeIndex);
        const framebuffers = this.framebuffers;
        const textures = this.textures;
        const firstEntry = bufferStack[0];
        let accumTexture = firstEntry.texture;
        let accumWeight = firstEntry.weight;
        let outputIndex = 1;
        let renderedDirectly = false;
        const target = skin._framebuffer.framebuffer || skin._framebuffer;
        if (modeIndex === 1 && firstEntry.weight !== 1) {
            let firstTarget = target;
            if (bufferStack.length !== 1) {
                this._ensureSecondaryBuffer();
                firstTarget = framebuffers[outputIndex];
            }
            this._render(this._program('stack'), firstTarget, [
                {name: 'u_accum', texture: firstEntry.texture},
                {name: 'u_sample', texture: firstEntry.texture}
            ], {
                u_mode: modeIndex,
                u_first: 1,
                u_accumWeight: 0,
                u_sampleWeight: firstEntry.weight
            }, STACK_INTEGER_UNIFORMS);
            if (bufferStack.length === 1) {
                this._markSkinChanged(skin);
                renderedDirectly = true;
            } else {
                accumTexture = textures[outputIndex];
                outputIndex = 1 - outputIndex;
            }
        }
        for (let i = 1; i < bufferStack.length; i++) {
            const entry = bufferStack[i];
            const isLast = i === bufferStack.length - 1;
            if (!isLast) this._ensureSecondaryBuffer();
            this._render(this._program('stack'), isLast ? target : framebuffers[outputIndex], [
                {name: 'u_accum', texture: accumTexture},
                {name: 'u_sample', texture: entry.texture}
            ], {
                u_mode: clampedModeIndex,
                u_first: 0,
                u_accumWeight: accumWeight,
                u_sampleWeight: entry.weight
            }, STACK_INTEGER_UNIFORMS);
            if (isLast) {
                this._markSkinChanged(skin);
                renderedDirectly = true;
            } else {
                accumTexture = textures[outputIndex];
                accumWeight += entry.weight;
                outputIndex = 1 - outputIndex;
            }
        }
        if (!renderedDirectly) this._replaceSkin(skin, accumTexture);
        if (clearAfter) this.clearBufferStack();
    };

    Engine.prototype.clearBufferStack = function () {
        const gl = this.gl;
        if (!this.bufferStack) return;
        const bufferStack = this.bufferStack;
        for (const entry of bufferStack) {
            gl.deleteFramebuffer(entry.framebuffer);
            gl.deleteTexture(entry.texture);
        }
        bufferStack.length = 0;
    };

    Engine.prototype.bufferStackSize = function () {
        return this.bufferStack.length;
    };

    PenFX.prototype.stackCurrentDrawing = function (args) {
        this._safe(engine => engine.stackCurrent(numberOr(args.WEIGHT, 1), numberOr(args.LIMIT, 10)));
    };

    PenFX.prototype.renderBufferStack = function (args) {
        const rawMode = String(args.MODE);
        const mode = STACK_MODES.includes(rawMode) ? rawMode : 'average';
        this._safe(engine => engine.renderBufferStack(mode, boolean(args.CLEAR)));
    };

    PenFX.prototype.clearBufferStack = function () {
        if (!this.engine) return;
        this._safe(engine => engine.clearBufferStack());
    };

    PenFX.prototype.bufferStackSize = function () {
        return this.engine ? this.engine.bufferStackSize() : 0;
    };
};

export default install;
