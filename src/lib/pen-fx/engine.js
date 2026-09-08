/* eslint-disable */

import {BLEND_MODES} from './constants';
import {programSources, vertex} from './shaders';

// Shared default uniforms for acerola passes. The nested arrays are treated as
// read-only by _render, so every pass can reference the same instances instead
// of allocating fresh ones per block invocation.
const ACEROLA_DEFAULT_UNIFORMS = {
    u_color: [0, 0, 0],
    u_color2: [0, 0, 0],
    u_color3: [0, 0, 0],
    u_color4: [1, 1, 1],
    u_mix: 1,
    u_time: 0,
    u_type: 0,
    u_type2: 0,
    u_value: 0,
    u_value2: 0,
    u_value3: 0,
    u_vec: [0, 0],
    u_vec2: [0, 0]
};

const createPenFXEngine = (gl, renderer) => {
    class PenFXEngine {
        constructor () {
            this.gl = gl;
            this.renderer = renderer;
            // Keep imported program sources scoped to this VM/renderer. The built-in
            // source table is shared by the module and must remain immutable.
            this.baseProgramSources = Object.assign({}, programSources);
            this.programSources = Object.assign({}, this.baseProgramSources);
            this.programs = Object.create(null);
            this.vertexShader = this._compileShader(gl.VERTEX_SHADER, vertex);
            this.quad = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                -1, -1, 1, -1, -1, 1, 1, 1
            ]), gl.STATIC_DRAW);
            this.width = 0;
            this.height = 0;
            this.resolution = new Float32Array(2);
            this.textures = [];
            this.framebuffers = [];
            this.bufferStack = [];
            this.groupStack = [];
            this.renderPasses = new Map();
            this.matteStack = [];
            this.frameTransaction = null;
            this.blendOpacity = 1;
            this.groupEffectScope = null;
            this.uniformCache = new WeakMap();
            this.positionCache = new WeakMap();
            this.programOverrides = null;
            this.pixelSortSource = null;
            this.pixelSortOutput = null;
            this.pixelSortKeys = null;
            this.pixelSortSelected = null;
            this.pixelSortIndices = [];
            this.pixelSortLine = [];
            this.blobSource = null;
            this.previousBlobFrame = null;
            this.blobOutput = null;
            this.depthTexture = null;
            this.depthSource = null;
            this.depthVersion = -1;
        }

        _compileShader (type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const message = gl.getShaderInfoLog(shader) || 'Unknown GLSL compile error';
                gl.deleteShader(shader);
                throw new Error(message);
            }
            return shader;
        }

        _createProgram (fragmentSource) {
            const fragment = this._compileShader(gl.FRAGMENT_SHADER, fragmentSource);
            const program = gl.createProgram();
            try {
                gl.attachShader(program, this.vertexShader);
                gl.attachShader(program, fragment);
                gl.linkProgram(program);
            } finally {
                gl.deleteShader(fragment);
            }
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                const message = gl.getProgramInfoLog(program) || 'Unknown GLSL link error';
                gl.deleteProgram(program);
                throw new Error(message);
            }
            return program;
        }

        validateCustomShader (fragmentSource) {
            const program = this._createProgram(fragmentSource);
            gl.deleteProgram(program);
        }

        registerCustomShader (name, fragmentSource) {
            const key = String(name);
            const existingProgram = this.programs[key];
            if (existingProgram) {
                gl.deleteProgram(existingProgram);
                delete this.programs[key];
            }
            this.programSources[key] = String(fragmentSource);
        }

        unregisterCustomShader (name) {
            const key = String(name);
            const existingProgram = this.programs[key];
            if (existingProgram) gl.deleteProgram(existingProgram);
            delete this.programs[key];
            if (Object.prototype.hasOwnProperty.call(this.baseProgramSources, key)) {
                this.programSources[key] = this.baseProgramSources[key];
            } else {
                delete this.programSources[key];
            }
        }

        _program (name) {
            if (this.programOverrides && this.programOverrides[name]) name = this.programOverrides[name];
            let program = this.programs[name];
            if (!program) {
                program = this._createProgram(this.programSources[name]);
                this.programs[name] = program;
            }
            return program;
        }

        withProgramOverrides (overrides, callback) {
            const previous = this.programOverrides;
            this.programOverrides = overrides;
            try {
                return callback();
            } finally {
                this.programOverrides = previous;
            }
        }

        _penSkin () {
            const id = renderer._penSkinId;
            return id === null || id === undefined ? null : renderer._allSkins[id];
        }

        _location (program, name) {
            let locations = this.uniformCache.get(program);
            if (!locations) {
                locations = new Map();
                this.uniformCache.set(program, locations);
            }
            if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
            return locations.get(name);
        }

        _position (program) {
            let position = this.positionCache.get(program);
            if (position === undefined) {
                position = gl.getAttribLocation(program, 'a_position');
                this.positionCache.set(program, position);
            }
            return position;
        }

        _resize (width, height) {
            if (this.width === width && this.height === height) return;
            this.clearBufferStack();
            this.clearGroupStack();
            this.clearMatteStack();
            this.clearRenderPasses();
            for (const framebuffer of this.framebuffers) gl.deleteFramebuffer(framebuffer);
            for (const texture of this.textures) gl.deleteTexture(texture);
            this.width = width;
            this.height = height;
            this.resolution[0] = width;
            this.resolution[1] = height;
            this.textures = [];
            this.framebuffers = [];
            this.pixelSortSource = null;
            this.pixelSortOutput = null;
            this.pixelSortKeys = null;
            this.pixelSortSelected = null;
            const primary = this._createBufferTexture();
            this.textures.push(primary.texture);
            this.framebuffers.push(primary.framebuffer);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        _ensureSecondaryBuffer () {
            if (this.textures.length > 1) return;
            const secondary = this._createBufferTexture();
            this.textures.push(secondary.texture);
            this.framebuffers.push(secondary.framebuffer);
        }

        _prepare (copySource = true, honorBlendOpacity = true) {
            if (honorBlendOpacity && this.blendOpacity <= 0) return null;
            const skin = this._penSkin();
            if (!skin || !skin._texture || !skin._framebuffer || !skin._size) return null;
            if (typeof renderer._doExitDrawRegion === 'function') renderer._doExitDrawRegion();
            this._resize(skin._size[0], skin._size[1]);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.SCISSOR_TEST);
            gl.disable(gl.BLEND);
            if (copySource) {
                const source = this._getGroupEffectSource(skin);
                this._render(this._program('copy'), this.framebuffers[0], [{name: 'u_image', texture: source}], {}, []);
            }
            return skin;
        }

        _getGroupEffectSource (skin) {
            const entry = this.groupStack[this.groupStack.length - 1];
            if (this.groupEffectScope !== 'expanded' || !entry || entry.skin !== skin ||
                skin._texture !== entry.texture) return skin._texture;
            if (!entry.effectSource) entry.effectSource = this._acquireGroupBuffer();
            // Build the expanded input lazily. The group remains isolated while objects are drawn, and only an
            // explicitly expanded effect sees the completed baseline underneath the group's pixels.
            this._renderGroupOver(entry.effectSource.framebuffer, entry.baselineTexture, entry.texture, 0, 1);
            return entry.effectSource.texture;
        }

        _renderGroupOver (framebuffer, baseTexture, effectTexture, blendMode, opacity) {
            // A custom shader package may override the public groupOver binding. This internal pass must always
            // use the built-in compositor, even when it is created while a custom effect's overrides are active.
            this.withProgramOverrides(null, () => this._render(this._program('groupOver'), framebuffer, [
                {name: 'u_base', texture: baseTexture},
                {name: 'u_effect', texture: effectTexture}
            ], {u_blend: blendMode, u_opacity: opacity}, ['u_blend']));
        }

        _finish (skin, effectTexture, blendMode) {
            const blendIndex = BLEND_MODES.indexOf(blendMode);
            if (blendIndex <= 0 && this.blendOpacity >= 1) {
                this._replaceSkin(skin, effectTexture);
                return;
            }
            const target = skin._framebuffer.framebuffer || skin._framebuffer;
            this._render(this._program('composite'), target, [
                {name: 'u_base', texture: this.textures[0]},
                {name: 'u_effect', texture: effectTexture}
            ], {u_blend: Math.max(0, blendIndex), u_opacity: this.blendOpacity}, ['u_blend']);
            this._markSkinChanged(skin);
        }

        _canRenderDirectly (blendMode) {
            const blendIndex = BLEND_MODES.indexOf(blendMode);
            return blendIndex <= 0 && this.blendOpacity >= 1;
        }

        _isNoOp (mixValue, blendMode) {
            return mixValue <= 0 && BLEND_MODES.indexOf(blendMode) <= 0;
        }

        _renderEffect (skin, program, samplers, uniforms, integerUniforms, blendMode) {
            if (this._canRenderDirectly(blendMode)) {
                const target = skin._framebuffer.framebuffer || skin._framebuffer;
                this._render(program, target, samplers, uniforms, integerUniforms);
                this._markSkinChanged(skin);
            } else {
                this._ensureSecondaryBuffer();
                this._render(program, this.framebuffers[1], samplers, uniforms, integerUniforms);
                this._finish(skin, this.textures[1], blendMode);
            }
            this._markExpandedGroupOutput(skin);
        }

        _markExpandedGroupOutput (skin) {
            const entry = this.groupStack[this.groupStack.length - 1];
            if (this.groupEffectScope === 'expanded' && entry && entry.skin === skin &&
                skin._texture === entry.texture) {
                entry.expandedOutput = true;
            }
        }

        _markSkinChanged (skin) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.activeTexture(gl.TEXTURE0);
            gl.enable(gl.BLEND);
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            skin._silhouetteDirty = true;
            if (typeof skin.emitWasAltered === 'function') skin.emitWasAltered();
            renderer.dirty = true;
        }

        _replaceSkin (skin, texture) {
            const target = skin._framebuffer.framebuffer || skin._framebuffer;
            this._render(this._program('copy'), target, [{name: 'u_image', texture}], {}, []);
            this._markSkinChanged(skin);
        }

        _restoreGLState () {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.activeTexture(gl.TEXTURE0);
            gl.colorMask(true, true, true, true);
            gl.disable(gl.STENCIL_TEST);
            gl.enable(gl.BLEND);
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        }

        _clearTransparent (framebuffer) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.SCISSOR_TEST);
            gl.disable(gl.STENCIL_TEST);
            gl.colorMask(true, true, true, true);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        drawDefaultBackground (color4f) {
            const skin = this._prepare(false, false);
            if (!skin) return false;
            const target = skin._framebuffer.framebuffer || skin._framebuffer;
            const background = Array.isArray(color4f) || ArrayBuffer.isView(color4f) ? color4f : [1, 1, 1, 1];
            gl.bindFramebuffer(gl.FRAMEBUFFER, target);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.SCISSOR_TEST);
            gl.disable(gl.STENCIL_TEST);
            gl.colorMask(true, true, true, true);
            gl.clearColor(background[0], background[1], background[2], background[3]);
            gl.clear(gl.COLOR_BUFFER_BIT);
            this._markSkinChanged(skin);
            return true;
        }

        _createBufferTexture () {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            const framebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            return {texture, framebuffer};
        }

        _uploadDepthBuffer (depthBuffer) {
            if (!depthBuffer || !depthBuffer.canvas) return null;
            if (!this.depthTexture) this.depthTexture = gl.createTexture();
            if (this.depthSource === depthBuffer.canvas && this.depthVersion === depthBuffer.version) {
                return this.depthTexture;
            }
            gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            const canRestorePixelStore = typeof gl.getParameter === 'function' && typeof gl.pixelStorei === 'function';
            const oldColorConversion = canRestorePixelStore ?
                gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) : null;
            const oldFlipY = canRestorePixelStore ? gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) : null;
            const oldPremultiply = canRestorePixelStore ? gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) : null;
            if (typeof gl.pixelStorei === 'function') {
                gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            }
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, depthBuffer.canvas);
            } finally {
                if (canRestorePixelStore) {
                    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, oldColorConversion);
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, oldFlipY);
                    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, oldPremultiply);
                }
            }
            this.depthSource = depthBuffer.canvas;
            this.depthVersion = depthBuffer.version;
            return this.depthTexture;
        }

        _acquireGroupBuffer () {
            const pool = this.groupBufferPool || (this.groupBufferPool = []);
            const buffer = pool.pop();
            if (buffer) return buffer;
            return {...this._createBufferTexture(), width: this.width, height: this.height};
        }

        _releaseGroupBuffer (buffer) {
            const pool = this.groupBufferPool || (this.groupBufferPool = []);
            // Retain only a small, bounded amount of idle GPU storage. Live nested groups never share targets.
            const pixels = this.width * this.height;
            const limit = Math.min(8, Math.floor((16 * 1024 * 1024) / Math.max(1, pixels)));
            if (buffer.width === this.width && buffer.height === this.height && pool.length < limit) {
                pool.push(buffer);
            } else {
                gl.deleteFramebuffer(buffer.framebuffer);
                gl.deleteTexture(buffer.texture);
            }
        }

        _clearGroupBufferPool () {
            for (const buffer of this.groupBufferPool || []) {
                gl.deleteFramebuffer(buffer.framebuffer);
                gl.deleteTexture(buffer.texture);
            }
            this.groupBufferPool = [];
        }

        beginGroup () {
            const skin = this._prepare(false, false);
            if (!skin) return;
            const staging = this._acquireGroupBuffer();
            const hadOwnGetTexture = Object.prototype.hasOwnProperty.call(skin, 'getTexture');
            const originalGetTexture = skin.getTexture;
            const baselineTexture = skin._texture;
            this.groupStack.push({
                buffer: staging,
                baselineFramebuffer: skin._framebuffer,
                baselineTexture,
                framebuffer: staging.framebuffer,
                hadOwnGetTexture,
                originalGetTexture,
                skin,
                texture: staging.texture
            });
            skin._texture = staging.texture;
            skin._framebuffer = {
                attachments: [staging.texture],
                framebuffer: staging.framebuffer,
                height: this.height,
                width: this.width
            };
            // Pen stamps and lines write to _texture/_framebuffer, while the stage samples getTexture(). Keep
            // the pre-group frame visible until endGroup composites so grouped draws never expose an
            // intermediate transparent (black) frame, even while asynchronous Object draws are pending.
            if (!hadOwnGetTexture) skin.getTexture = () => baselineTexture;
            // Scratch's renderer can leave write masks or stencil state configured after a draw. Reset them before
            // clearing so the isolated group layer always starts with RGBA (0, 0, 0, 0).
            this._clearTransparent(staging.framebuffer);
            this._restoreGLState();
        }

        endGroup (options = {}) {
            if (!this.groupStack.length) return;
            const entry = this.groupStack.pop();
            const skin = entry.skin;
            const blendMode = String(options.blendMode || 'normal');
            const blendIndex = Math.max(0, BLEND_MODES.indexOf(blendMode));
            const requestedOpacity = Number(options.opacity);
            const opacity = Number.isFinite(requestedOpacity) ? Math.max(0, Math.min(1, requestedOpacity)) : 1;
            const passName = String(options.passName || '').trim();
            const shouldComposite = options.composite !== false;
            // The pen skin may have been resized or replaced while the group was open. Only composite when the
            // staged texture is still installed so we never render into a stale framebuffer.
            const stillStaged = Boolean(skin) && skin._texture === entry.texture;
            if (stillStaged) {
                skin._texture = entry.baselineTexture;
                skin._framebuffer = entry.baselineFramebuffer;
                this._restoreTextureGetter(skin, entry.hadOwnGetTexture, entry.originalGetTexture);
                if (shouldComposite && this._prepare(false, false) === skin) {
                    if (entry.expandedOutput) {
                        // An expanded effect already rendered the baseline into the group result. Composite that
                        // full-frame result against the baseline, rather than applying the group alpha mask again.
                        this._render(this._program('composite'), this.framebuffers[0], [
                            {name: 'u_base', texture: entry.baselineTexture},
                            {name: 'u_effect', texture: entry.texture}
                        ], {u_blend: blendIndex, u_opacity: opacity}, ['u_blend']);
                        this._replaceSkin(skin, this.textures[0]);
                    } else if (blendIndex === 0 && opacity === 1) {
                        // Premultiplied source-over can blend directly into the baseline. This avoids reading
                        // the full baseline into a temporary texture and then copying the result back.
                        gl.enable(gl.BLEND);
                        gl.blendEquation(gl.FUNC_ADD);
                        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                        const target = skin._framebuffer.framebuffer || skin._framebuffer;
                        this.withProgramOverrides(null, () => this._render(this._program('copy'), target,
                            [{name: 'u_image', texture: entry.texture}], {}, []));
                        this._markSkinChanged(skin);
                    } else {
                        // Composite the isolated group content over the untouched baseline instead of replacing it,
                        // so the default pen backdrop and earlier drawings survive every group.
                        this._renderGroupOver(
                            this.framebuffers[0], entry.baselineTexture, entry.texture, blendIndex, opacity
                        );
                        this._replaceSkin(skin, this.textures[0]);
                    }
                }
            }
            if (passName && stillStaged) {
                const previous = this.renderPasses.get(passName);
                if (previous) {
                    gl.deleteFramebuffer(previous.framebuffer);
                    gl.deleteTexture(previous.texture);
                }
                this.renderPasses.set(passName, {
                    framebuffer: entry.framebuffer,
                    height: this.height,
                    texture: entry.texture,
                    width: this.width
                });
            } else {
                this._releaseGroupBuffer(entry.buffer);
            }
            if (entry.effectSource) {
                this._releaseGroupBuffer(entry.effectSource);
            }
        }

        drawRenderPass (name, options = {}) {
            const entry = this.renderPasses.get(String(name || '').trim());
            if (!entry) return false;
            const skin = this._prepare(false, false);
            if (!skin || entry.width !== this.width || entry.height !== this.height) return false;
            const blendMode = String(options.blendMode || 'normal');
            const blendIndex = Math.max(0, BLEND_MODES.indexOf(blendMode));
            const requestedOpacity = Number(options.opacity);
            const opacity = Number.isFinite(requestedOpacity) ? Math.max(0, Math.min(1, requestedOpacity)) : 1;
            this._render(this._program('groupOver'), this.framebuffers[0], [
                {name: 'u_base', texture: skin._texture},
                {name: 'u_effect', texture: entry.texture}
            ], {u_blend: blendIndex, u_opacity: opacity}, ['u_blend']);
            this._replaceSkin(skin, this.textures[0]);
            return true;
        }

        clearRenderPass (name) {
            const key = String(name || '').trim();
            const entry = this.renderPasses.get(key);
            if (!entry) return false;
            gl.deleteFramebuffer(entry.framebuffer);
            gl.deleteTexture(entry.texture);
            this.renderPasses.delete(key);
            return true;
        }

        clearRenderPasses () {
            if (!(this.renderPasses instanceof Map)) return;
            for (const entry of this.renderPasses.values()) {
                gl.deleteFramebuffer(entry.framebuffer);
                gl.deleteTexture(entry.texture);
            }
            this.renderPasses.clear();
        }

        beginMatte () {
            const skin = this._prepare(false, false);
            if (!skin) return false;
            const source = this._createBufferTexture();
            const hadOwnGetTexture = Object.prototype.hasOwnProperty.call(skin, 'getTexture');
            const originalGetTexture = skin.getTexture;
            const baselineTexture = skin._texture;
            this.matteStack.push({
                baselineFramebuffer: skin._framebuffer,
                baselineTexture,
                hadOwnGetTexture,
                mask: null,
                originalGetTexture,
                skin,
                source
            });
            skin._texture = source.texture;
            skin._framebuffer = {
                attachments: [source.texture],
                framebuffer: source.framebuffer,
                height: this.height,
                width: this.width
            };
            if (!hadOwnGetTexture) skin.getTexture = () => baselineTexture;
            this._clearTransparent(source.framebuffer);
            this._restoreGLState();
            return true;
        }

        beginMatteMask () {
            if (!this.matteStack.length) return false;
            const entry = this.matteStack[this.matteStack.length - 1];
            const {skin, source} = entry;
            if (!skin || skin._texture !== source.texture) return false;
            const mask = this._createBufferTexture();
            entry.mask = mask;
            skin._texture = mask.texture;
            skin._framebuffer = {
                attachments: [mask.texture],
                framebuffer: mask.framebuffer,
                height: this.height,
                width: this.width
            };
            this._clearTransparent(mask.framebuffer);
            this._restoreGLState();
            return true;
        }

        endMatte (options = {}) {
            if (!this.matteStack.length) return false;
            const entry = this.matteStack.pop();
            const {mask, skin, source} = entry;
            const stillStaged = Boolean(mask && skin) && skin._texture === mask.texture;
            if (stillStaged) {
                skin._texture = entry.baselineTexture;
                skin._framebuffer = entry.baselineFramebuffer;
                this._restoreTextureGetter(skin, entry.hadOwnGetTexture, entry.originalGetTexture);
                if (this._prepare(false, false) === skin) {
                    const modes = ['alpha', 'luma', 'alpha inverted', 'luma inverted'];
                    const modeIndex = Math.max(0, modes.indexOf(String(options.mode || 'alpha').toLowerCase()));
                    this._render(this._program('matteOver'), this.framebuffers[0], [
                        {name: 'u_base', texture: entry.baselineTexture},
                        {name: 'u_source', texture: source.texture},
                        {name: 'u_matte', texture: mask.texture}
                    ], {u_mode: modeIndex}, ['u_mode']);
                    this._replaceSkin(skin, this.textures[0]);
                }
            } else if (skin && (skin._texture === source.texture || (mask && skin._texture === mask.texture))) {
                skin._texture = entry.baselineTexture;
                skin._framebuffer = entry.baselineFramebuffer;
                this._restoreTextureGetter(skin, entry.hadOwnGetTexture, entry.originalGetTexture);
            }
            gl.deleteFramebuffer(source.framebuffer);
            gl.deleteTexture(source.texture);
            if (mask) {
                gl.deleteFramebuffer(mask.framebuffer);
                gl.deleteTexture(mask.texture);
            }
            return stillStaged;
        }

        beginFrame () {
            if (this.frameTransaction) return false;
            const skin = this._penSkin();
            if (!skin || !skin._texture || !skin._framebuffer || !skin._size) return false;
            if (typeof renderer._doExitDrawRegion === 'function') renderer._doExitDrawRegion();
            this._resize(skin._size[0], skin._size[1]);
            const staging = this._createBufferTexture();
            gl.bindTexture(gl.TEXTURE_2D, staging.texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            const hadOwnGetTexture = Object.prototype.hasOwnProperty.call(skin, 'getTexture');
            const originalGetTexture = skin.getTexture;
            const baselineTexture = skin._texture;
            this.frameTransaction = {
                baselineFramebuffer: skin._framebuffer,
                baselineTexture,
                hadOwnGetTexture,
                originalGetTexture,
                skin,
                stagingFramebuffer: staging.framebuffer,
                stagingTexture: staging.texture
            };
            skin._texture = staging.texture;
            skin._framebuffer = {
                attachments: [staging.texture],
                framebuffer: staging.framebuffer,
                height: this.height,
                width: this.width
            };
            // Pen operations use _texture/_framebuffer, while stage drawing asks getTexture(). Keep the completed
            // previous frame visible until the staged pen texture is committed.
            skin.getTexture = () => baselineTexture;
            this._clearTransparent(staging.framebuffer);
            this._restoreGLState();
            return true;
        }

        restoreFrameTextureGetter (transaction) {
            this._restoreTextureGetter(transaction.skin, transaction.hadOwnGetTexture, transaction.originalGetTexture);
        }

        _restoreTextureGetter (skin, hadOwnGetTexture, originalGetTexture) {
            if (hadOwnGetTexture) {
                skin.getTexture = originalGetTexture;
            } else {
                delete skin.getTexture;
            }
        }

        commitFrame () {
            const transaction = this.frameTransaction;
            if (!transaction) return false;
            if (typeof renderer._doExitDrawRegion === 'function') renderer._doExitDrawRegion();
            this.frameTransaction = null;
            this.restoreFrameTextureGetter(transaction);
            const baselineFramebuffer = transaction.baselineFramebuffer.framebuffer || transaction.baselineFramebuffer;
            gl.deleteFramebuffer(baselineFramebuffer);
            gl.deleteTexture(transaction.baselineTexture);
            this._markSkinChanged(transaction.skin);
            return true;
        }

        cancelFrame () {
            const transaction = this.frameTransaction;
            if (!transaction) return false;
            if (typeof renderer._doExitDrawRegion === 'function') renderer._doExitDrawRegion();
            this.frameTransaction = null;
            gl.deleteFramebuffer(transaction.stagingFramebuffer);
            gl.deleteTexture(transaction.stagingTexture);
            transaction.skin._texture = transaction.baselineTexture;
            transaction.skin._framebuffer = transaction.baselineFramebuffer;
            this.restoreFrameTextureGetter(transaction);
            this._restoreGLState();
            return true;
        }

        clearGroupStack () {
            if (!this.groupStack) return;
            for (let i = this.groupStack.length - 1; i >= 0; i--) {
                const entry = this.groupStack[i];
                const skin = entry.skin;
                if (skin && skin._texture === entry.texture) {
                    skin._texture = entry.baselineTexture;
                    skin._framebuffer = entry.baselineFramebuffer;
                    this._restoreTextureGetter(skin, entry.hadOwnGetTexture, entry.originalGetTexture);
                }
                gl.deleteFramebuffer(entry.framebuffer);
                gl.deleteTexture(entry.texture);
                if (entry.effectSource) {
                    gl.deleteFramebuffer(entry.effectSource.framebuffer);
                    gl.deleteTexture(entry.effectSource.texture);
                }
            }
            this.groupStack.length = 0;
            this._clearGroupBufferPool();
        }

        clearMatteStack () {
            if (!this.matteStack) return;
            for (let index = this.matteStack.length - 1; index >= 0; index--) {
                const entry = this.matteStack[index];
                const {mask, skin, source} = entry;
                if (skin && (skin._texture === source.texture || (mask && skin._texture === mask.texture))) {
                    skin._texture = entry.baselineTexture;
                    skin._framebuffer = entry.baselineFramebuffer;
                    this._restoreTextureGetter(skin, entry.hadOwnGetTexture, entry.originalGetTexture);
                }
                gl.deleteFramebuffer(source.framebuffer);
                gl.deleteTexture(source.texture);
                if (mask) {
                    gl.deleteFramebuffer(mask.framebuffer);
                    gl.deleteTexture(mask.texture);
                }
            }
            this.matteStack.length = 0;
        }

        _render (program, framebuffer, samplers, uniforms, integerUniforms) {
            // A work texture can still be bound on an otherwise-unused texture unit
            // from the previous pass. Some ANGLE backends treat that as a feedback
            // loop when the same texture becomes the next render target, so clear the
            // units before attaching the target framebuffer.
            for (let i = 0; i < 2; i++) {
                gl.activeTexture(gl.TEXTURE0 + i);
                gl.bindTexture(gl.TEXTURE_2D, null);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.viewport(0, 0, this.width, this.height);
            gl.useProgram(program);
            const position = this._position(program);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
            gl.enableVertexAttribArray(position);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
            for (let i = 0; i < samplers.length; i++) {
                gl.activeTexture(gl.TEXTURE0 + i);
                gl.bindTexture(gl.TEXTURE_2D, samplers[i].texture);
                gl.uniform1i(this._location(program, samplers[i].name), i);
            }
            for (const name in uniforms) {
                const value = uniforms[name];
                const location = this._location(program, name);
                if (integerUniforms.indexOf(name) !== -1) {
                    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
                        if (value.length === 2) gl.uniform2iv(location, value);
                        else if (value.length === 3) gl.uniform3iv(location, value);
                        else if (value.length === 4) gl.uniform4iv(location, value);
                    } else {
                        gl.uniform1i(location, value);
                    }
                } else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
                    if (value.length === 2) gl.uniform2fv(location, value);
                    else if (value.length === 3) gl.uniform3fv(location, value);
                    else if (value.length === 4) gl.uniform4fv(location, value);
                } else {
                    gl.uniform1f(location, value);
                }
            }
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        _singlePass (program, uniforms, integerUniforms, blendMode) {
            if (Object.prototype.hasOwnProperty.call(uniforms, 'u_mix') && this._isNoOp(uniforms.u_mix, blendMode)) return;
            const skin = this._prepare();
            if (!skin) return;
            if (Object.prototype.hasOwnProperty.call(uniforms, 'u_resolution')) {
                uniforms.u_resolution = this.resolution;
            }
            this._renderEffect(skin, program, [{name: 'u_image', texture: this.textures[0]}], uniforms, integerUniforms, blendMode);
        }

        _acerolaPass (program, mode, uniforms, integerUniforms, blendMode) {
            this._singlePass(program, Object.assign({
                u_mode: mode,
                u_resolution: this.resolution
            }, ACEROLA_DEFAULT_UNIFORMS, uniforms), ['u_mode', 'u_type', 'u_type2'].concat(integerUniforms || []), blendMode);
        }

        customShader (name, uniforms, integerUniforms, blendMode) {
            this._singlePass(this._program(name), uniforms, integerUniforms || [], blendMode);
        }
    }

    return PenFXEngine;
};

export default createPenFXEngine;
