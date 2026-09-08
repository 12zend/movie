import {
    cameraLookAt,
    DEFAULT_DEPTH,
    DEFAULT_FOCAL_LENGTH,
    DEFAULT_STAGE_HEIGHT,
    DEFAULT_STAGE_WIDTH,
    focalLengthFromFOV,
    normalizeFOV,
    projectPosition,
    spritePlaneMatrix
} from './model-runtime';
import {FRAME_GRAPH_NODE_TYPES} from './movie-frame-graph';
import {
    cloneCamera,
    normalizeRotationOrder,
    normalizeScale,
    toNumber
} from './movie-asset-manager-utils';

const MovieAssetManagerTransformMethods = {
    getTargetState (target) {
        let state = this.targetStates.get(target.id);
        if (!state) {
            state = {
                currentFrame: 1,
                displayedFrame: null,
                displayedVideoAssetId: null,
                ignoreCamera: false,
                mode: 'costume',
                modelCanvas: null,
                modelAssetId: null,
                modelFrame: 1,
                modelRenderCamera: null,
                modelScene: [],
                modelRenderPromise: null,
                modelRenderVersion: 0,
                objectDrawPromise: null,
                objectDrawQueue: [],
                objectDrawVersion: 0,
                objectVideo: null,
                objectVideoAssetId: null,
                penOnly: false,
                pendingVideoFrame: null,
                videoFrameQueue: [],
                projectionKey: null,
                renderVersion: 0,
                rotation: {x: 0, y: 0, z: 90 - (target.direction || 90)},
                rotationOrder: 'XYZ',
                scale: {x: 1, y: 1, z: 1},
                requestedMode: 'costume',
                depthResource: null,
                shapeSkinId: null,
                skinId: null,
                textKey: null,
                textQueue: [],
                textRenderPromise: null,
                video: null,
                videoBitmap: null,
                videoAssetId: null,
                videoElementAssetId: null,
                videoRenderPromise: null,
                worldX: toNumber(target.x),
                worldY: toNumber(target.y),
                worldZ: DEFAULT_DEPTH
            };
            this.targetStates.set(target.id, state);
        }
        return state;
    },

    setTargetXY (target, x, y, force) {
        if (!target || target.isStage || (target.dragging && !force)) return;
        const state = this.getTargetState(target);
        const oldX = target.x;
        const oldY = target.y;
        state.ignoreCamera = false;
        state.worldX = toNumber(x, state.worldX);
        state.worldY = toNumber(y, state.worldY);
        target.x = state.worldX;
        target.y = state.worldY;
        this.applyProjection(target);
        this.rerenderTargetModel(target);
        if (target.onTargetMoved) target.onTargetMoved(target, oldX, oldY, force);
        this.runtime.requestTargetsUpdate(target);
    },

    setTargetPosition (target, x, y, z) {
        if (!target || target.isStage) return;
        const state = this.getTargetState(target);
        state.ignoreCamera = false;
        state.worldZ = toNumber(z, state.worldZ);
        this.setTargetXY(target, x, y);
    },

    setTargetPositionWithoutCamera (target, x, y, z) {
        if (!target || target.isStage) return;
        const state = this.getTargetState(target);
        const oldX = target.x;
        const oldY = target.y;
        state.ignoreCamera = true;
        state.worldX = toNumber(x, state.worldX);
        state.worldY = toNumber(y, state.worldY);
        state.worldZ = toNumber(z, state.worldZ);
        target.x = state.worldX;
        target.y = state.worldY;
        this.applyProjection(target);
        this.rerenderTargetModel(target);
        if (target.onTargetMoved) target.onTargetMoved(target, oldX, oldY);
        this.runtime.requestTargetsUpdate(target);
    },

    setTargetAxis (target, axis, value) {
        const state = this.getTargetState(target);
        const next = toNumber(value, state[`world${axis.toUpperCase()}`]);
        this.setTargetPosition(
            target,
            axis === 'x' ? next : state.worldX,
            axis === 'y' ? next : state.worldY,
            axis === 'z' ? next : state.worldZ
        );
    },

    changeTargetPosition (target, axis, amount) {
        const state = this.getTargetState(target);
        const key = `world${axis.toUpperCase()}`;
        this.setTargetAxis(target, axis, state[key] + toNumber(amount));
    },

    setLegacyDirection (target, direction) {
        if (!target || target.isStage || !Number.isFinite(Number(direction))) return;
        const normalized = ((((Number(direction) + 179) % 360) + 360) % 360) - 179;
        const state = this.getTargetState(target);
        target.direction = normalized;
        state.rotation.z = 90 - normalized;
        this.refreshTargetRotation(target);
        this.runtime.requestTargetsUpdate(target);
    },

    setTargetRotation (target, x, y, z) {
        if (!target || target.isStage) return;
        const state = this.getTargetState(target);
        state.rotation.x = toNumber(x, state.rotation.x);
        state.rotation.y = toNumber(y, state.rotation.y);
        state.rotation.z = toNumber(z, state.rotation.z);
        target.direction = 90 - state.rotation.z;
        this.refreshTargetRotation(target);
        this.runtime.requestTargetsUpdate(target);
    },

    setTargetScale (target, x, y, z) {
        if (!target || target.isStage) return;
        const state = this.getTargetState(target);
        state.scale = {
            x: normalizeScale(x, state.scale.x),
            y: normalizeScale(y, state.scale.y),
            z: normalizeScale(z, state.scale.z)
        };
        this.applyProjection(target);
        this.rerenderTargetModel(target);
        this.runtime.requestTargetsUpdate(target);
    },

    changeTargetRotation (target, x, y, z) {
        const state = this.getTargetState(target);
        this.setTargetRotation(
            target,
            state.rotation.x + toNumber(x),
            state.rotation.y + toNumber(y),
            state.rotation.z + toNumber(z)
        );
    },

    setTargetRotationOrder (target, order) {
        const state = this.getTargetState(target);
        state.rotationOrder = normalizeRotationOrder(order);
        state.projectionKey = null;
        this.refreshTargetRotation(target);
    },

    refreshTargetRotation (target) {
        this.rerenderTargetModel(target);
        this.applyProjection(target);
    },

    rerenderTargetModel (target) {
        const state = this.getTargetState(target);
        if (state.requestedMode !== 'model' || !state.modelScene.length) return;
        // A render-model block captures the transform at that point in the script. Do not move models which have
        // already been added to the temporary scene when the sprite transform changes later.
    },

    getStageSize () {
        if (this.runtime.renderer && typeof this.runtime.renderer.getNativeSize === 'function') {
            const size = this.runtime.renderer.getNativeSize();
            if (Array.isArray(size) && size.length >= 2) {
                return [toNumber(size[0], DEFAULT_STAGE_WIDTH), toNumber(size[1], DEFAULT_STAGE_HEIGHT)];
            }
        }
        return [DEFAULT_STAGE_WIDTH, DEFAULT_STAGE_HEIGHT];
    },

    setFOV (value) {
        const [width, height] = this.getStageSize();
        this.camera.fov = normalizeFOV(value);
        this.camera.focalLength = focalLengthFromFOV(this.camera.fov, width, height);
        this.cameraChanged();
    },

    handleNativeSizeChanged (event) {
        const size = event && Array.isArray(event.newSize) ? event.newSize : this.getStageSize();
        if (this.timeline) {
            this.timeline.width = Math.max(1, Math.round(toNumber(size[0], this.timeline.width)));
            this.timeline.height = Math.max(1, Math.round(toNumber(size[1], this.timeline.height)));
            this.emitTimelineChanged();
        }
        this.camera.focalLength = focalLengthFromFOV(this.camera.fov, size[0], size[1]);
        this.applyCamera();
        this.emit('cameraChanged', cloneCamera(this.camera));
    },

    setCameraPosition (x, y, z) {
        this.camera.position.x = toNumber(x, this.camera.position.x);
        this.camera.position.y = toNumber(y, this.camera.position.y);
        this.camera.position.z = toNumber(z, this.camera.position.z);
        this.cameraChanged();
    },

    setCameraAxis (axis, value) {
        this.camera.position[axis] = toNumber(value, this.camera.position[axis]);
        this.cameraChanged();
    },

    changeCameraAxis (axis, amount) {
        this.setCameraAxis(axis, this.camera.position[axis] + toNumber(amount));
    },

    setCameraRotation (x, y, z) {
        this.camera.rotation.x = toNumber(x, this.camera.rotation.x);
        this.camera.rotation.y = toNumber(y, this.camera.rotation.y);
        this.camera.rotation.z = toNumber(z, this.camera.rotation.z);
        this.cameraChanged(true);
    },

    changeCameraRotation (x, y, z) {
        this.setCameraRotation(
            this.camera.rotation.x + toNumber(x),
            this.camera.rotation.y + toNumber(y),
            this.camera.rotation.z + toNumber(z)
        );
    },

    setCameraRotationOrder (order) {
        this.camera.rotationOrder = normalizeRotationOrder(order);
        this.cameraChanged(true);
    },

    lookAt (args) {
        const position = {
            x: toNumber(args.CAMERAX, this.camera.position.x),
            y: toNumber(args.CAMERAY, this.camera.position.y),
            z: toNumber(args.CAMERAZ, this.camera.position.z)
        };
        const target = {
            x: toNumber(args.X),
            y: toNumber(args.Y),
            z: toNumber(args.Z, DEFAULT_DEPTH)
        };
        this.camera.position = position;
        this.camera.rotation = cameraLookAt(position, target, this.camera.rotationOrder);
        this.cameraChanged(true);
    },

    cameraChanged (rerenderModels = true) {
        this.cameraVersion = (Number(this.cameraVersion) || 0) + 1;
        this.runtime.emitProjectChanged();
        if (this.isCollectingFrameGraph()) {
            // Camera changes are ordered scene-state operations. Appending the snapshot here preserves
            // set-camera A -> Draw -> set-camera B exactly; no final camera is retroactively applied at flush.
            this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.SCENE, {
                operation: 'camera',
                rerenderModels,
                sceneKind: 'camera'
            });
            this.emit('cameraChanged', cloneCamera(this.camera));
            return;
        }
        this.applyCamera(rerenderModels);
        this.emit('cameraChanged', cloneCamera(this.camera));
    },

    applyCamera (rerenderModels = true, requestedCamera = null) {
        const camera = requestedCamera || this.camera;
        for (const target of this.runtime.targets || []) {
            if (target.isStage) continue;
            this.applyProjection(target, camera);
            if (rerenderModels) {
                const state = this.getTargetState(target);
                if (state.mode === 'model') {
                    this.runWithoutWaiting(this.queueModelSceneRender(target, camera, true));
                }
            }
        }
        this.runtime.requestRedraw();
    },

    applyFrameGraphCamera (requestedCamera, rerenderModels = true) {
        const camera = requestedCamera || cloneCamera(this.camera);
        const renders = [];
        for (const target of this.runtime.targets || []) {
            if (target.isStage) continue;
            this.applyProjection(target, camera);
            if (!rerenderModels) continue;
            const state = this.getTargetState(target);
            if (state.mode !== 'model') continue;
            const render = this.queueModelSceneRender(target, camera, true);
            if (render && typeof render.then === 'function') renders.push(render);
        }
        this.runtime.requestRedraw();
        if (renders.length) return Promise.all(renders);
    },

    applyProjection (target, requestedCamera = null) {
        if (!target || target.isStage || !this.runtime.renderer || target.drawableID === null) return;
        if (
            typeof this.runtime.renderer.updateDrawablePosition !== 'function' ||
            typeof this.runtime.renderer.updateDrawableDirectionScale !== 'function' ||
            typeof this.runtime.renderer.updateDrawableVisible !== 'function'
        ) return;
        const state = this.getTargetState(target);
        if ((this.projectionBatchDepth || 0) > 0) return;
        const camera = requestedCamera || this.camera || {
            focalLength: DEFAULT_FOCAL_LENGTH,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        };
        const cameraPosition = camera.position || {};
        const cameraRotation = camera.rotation || {};
        const projectionKey = [
            state.mode,
            state.penOnly,
            target.visible,
            state.worldX,
            state.worldY,
            state.worldZ,
            state.ignoreCamera,
            state.rotation.x,
            state.rotation.y,
            state.rotation.z,
            state.rotationOrder,
            state.scale.x,
            state.scale.y,
            state.scale.z,
            target.size,
            target.currentCostume,
            state.skinId,
            state.shapeSkinId,
            state.sharedTextSkinId,
            camera.focalLength,
            camera.rotationOrder,
            cameraPosition.x,
            cameraPosition.y,
            cameraPosition.z,
            cameraRotation.x,
            cameraRotation.y,
            cameraRotation.z
        ].join('|');
        if (state.projectionKey === projectionKey) return;
        state.projectionKey = projectionKey;
        if (state.mode === 'model' || state.mode === 'scene') {
            this.runtime.renderer.updateDrawablePosition(target.drawableID, [0, 0]);
            this.runtime.renderer.updateDrawableDirectionScale(target.drawableID, 90, [100, 100]);
            const drawable = this.runtime.renderer._allDrawables &&
                this.runtime.renderer._allDrawables[target.drawableID];
            if (drawable && typeof drawable.getUniforms === 'function') {
                const uniforms = drawable.getUniforms();
                const matrix = uniforms && uniforms.u_modelMatrix;
                if (matrix) {
                    // Scratch only recalculates the six affine XY entries. Clear the projective
                    // entries left by spritePlaneMatrix before displaying an already-projected scene.
                    matrix[2] = matrix[3] = matrix[6] = matrix[7] = 0;
                    matrix[8] = matrix[9] = matrix[11] = matrix[14] = 0;
                    matrix[10] = matrix[15] = 1;
                    drawable._inverseTransformDirty = true;
                    drawable._transformedHullDirty = true;
                }
            }
            this.runtime.renderer.updateDrawableVisible(target.drawableID, target.visible && !state.penOnly);
            if (target.visible) {
                target.emitVisualChange();
                this.runtime.requestRedraw();
            }
            return;
        }
        const projection = state.ignoreCamera ? {
            inFront: true,
            perspective: 1,
            x: state.worldX,
            y: state.worldY
        } : projectPosition({
            x: state.worldX,
            y: state.worldY,
            z: state.worldZ
        }, camera);
        this.runtime.renderer.updateDrawablePosition(target.drawableID, [projection.x, projection.y]);
        const cameraRotationZ = state.ignoreCamera ? 0 :
            toNumber(camera.rotation && camera.rotation.z);
        const direction = state.mode === 'model' ? 90 : 90 - state.rotation.z + cameraRotationZ;
        const renderedScale = typeof target._getRenderedDirectionAndScale === 'function' ?
            target._getRenderedDirectionAndScale().scale : [target.size, target.size];
        const perspective = Math.abs(projection.perspective);
        this.runtime.renderer.updateDrawableDirectionScale(target.drawableID, direction, [
            renderedScale[0] * state.scale.x * perspective,
            renderedScale[1] * state.scale.y * perspective
        ]);
        this.applySpritePlaneMatrix(target, state, renderedScale, camera);
        this.runtime.renderer.updateDrawableVisible(
            target.drawableID,
            target.visible && projection.inFront && !state.penOnly
        );
        if (target.visible) {
            target.emitVisualChange();
            this.runtime.requestRedraw();
        }
    },

    applySpritePlaneMatrix (target, state, renderedScale, requestedCamera = null) {
        const renderer = this.runtime.renderer;
        const drawable = renderer && renderer._allDrawables && renderer._allDrawables[target.drawableID];
        if (!drawable || !drawable.skin || typeof drawable.getUniforms !== 'function') return;
        const camera = state.ignoreCamera ? {
            focalLength: DEFAULT_FOCAL_LENGTH,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        } : (requestedCamera || this.camera || {
            focalLength: DEFAULT_FOCAL_LENGTH,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        });
        const matrix = spritePlaneMatrix({
            position: {
                x: state.worldX,
                y: state.worldY,
                z: state.ignoreCamera ? DEFAULT_FOCAL_LENGTH : state.worldZ
            },
            rotation: state.rotation,
            rotationOrder: state.rotationOrder,
            scale: state.scale
        }, camera, drawable.skin.size, drawable.skin.rotationCenter, renderedScale);
        const uniforms = drawable.getUniforms();
        if (!uniforms || !uniforms.u_modelMatrix) return;
        uniforms.u_modelMatrix.set(matrix);
        drawable._inverseTransformDirty = true;
        drawable._transformedHullDirty = true;
    }
};

export default MovieAssetManagerTransformMethods;
