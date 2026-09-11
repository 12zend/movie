import {
    createBuildingPrimitive,
    loadBuildingTexture,
    makeBuildingMaterial,
    ModelRenderer,
    projectPosition,
    DEFAULT_FOCAL_LENGTH
} from './model-runtime';
import {
    BITMAP_RESOLUTION
} from './movie-asset-manager-constants';
import {
    clamp,
    cloneCamera,
    cloneScale,
    getOriginalTarget
} from './movie-asset-manager-utils';
import {
    createDepthResource as makeDepthResource
} from './movie-depth-resource';

const MAX_BUILDING_PRIMITIVES = 512;

const MovieAssetManagerModelMethods = {
    getModelTransform (target, state = this.getTargetState(target)) {
        return {
            rotation: {...state.rotation},
            rotationOrder: state.rotationOrder,
            scale: cloneScale(state.scale),
            size: target.size,
            worldX: state.worldX,
            worldY: state.worldY,
            worldZ: state.worldZ
        };
    },

    clearModelScene (target, render = true, requestedCamera = null) {
        const state = this.getTargetState(target);
        if (state.requestedMode !== 'model') state.renderVersion++;
        state.modelAssetId = null;
        state.modelScene = [];
        state.requestedMode = 'model';
        state.textKey = null;
        state.projectionKey = null;
        this.clearPendingVideoFrames(state);
        state.textQueue.length = 0;
        if (render) {
            return requestedCamera ? this.queueModelSceneRender(target, requestedCamera) :
                this.queueModelSceneRender(target);
        }
        return true;
    },

    normalizeBuildingMaterialName (requestedName) {
        return String(requestedName || '').trim() || 'material';
    },

    getBuildingMaterialRecord (requestedName) {
        const name = this.normalizeBuildingMaterialName(requestedName);
        let record = this.buildingMaterials.get(name);
        if (!record) {
            record = {
                albedo: '#ff00ff',
                albedoTexture: null,
                albedoTexturePending: null,
                albedoTextureSource: null,
                displacementTexture: null,
                displacementTexturePending: null,
                displacementTextureSource: null,
                emission: '#000000',
                emissionTexture: null,
                emissionTexturePending: null,
                emissionTextureSource: null,
                ior: 1.45,
                material: makeBuildingMaterial(),
                name,
                normalTexture: null,
                normalTexturePending: null,
                normalTextureSource: null,
                roughness: 1,
                roughnessTexture: null,
                roughnessTexturePending: null,
                roughnessTextureSource: null,
                textureVersions: {
                    albedo: 0,
                    displacement: 0,
                    emission: 0,
                    normal: 0,
                    roughness: 0
                }
            };
            this.buildingMaterials.set(name, record);
        }
        return record;
    },

    syncBuildingMaterial (record) {
        const material = record.material;
        const mapsChanged = material.map !== record.albedoTexture ||
            material.displacementMap !== record.displacementTexture ||
            material.emissiveMap !== record.emissionTexture ||
            material.normalMap !== record.normalTexture ||
            material.roughnessMap !== record.roughnessTexture;
        try {
            material.color.set(record.albedoTexture ? '#ffffff' : record.albedo);
        } catch (error) {
            material.color.set('#ff00ff');
        }
        try {
            material.emissive.set(record.emissionTexture ? '#ffffff' : record.emission);
        } catch (error) {
            material.emissive.set('#000000');
        }
        material.map = record.albedoTexture;
        material.displacementMap = record.displacementTexture;
        material.emissiveMap = record.emissionTexture;
        material.normalMap = record.normalTexture;
        material.ior = record.ior;
        material.roughness = record.roughness;
        material.roughnessMap = record.roughnessTexture;
        if (mapsChanged) {
            material.needsUpdate = true;
        }
        if (this.modelRenderer && typeof this.modelRenderer.invalidateRenderCache === 'function') {
            this.modelRenderer.invalidateRenderCache();
        }
    },

    rerenderBuildingScenes () {
        for (const target of this.runtime.targets || []) {
            const state = this.targetStates.get(target.id);
            if (!state || state.requestedMode !== 'model' ||
                !state.modelScene.some(item => item.sourceObject)) continue;
            this.runWithoutWaiting(this.queueModelSceneRender(target));
        }
    },

    resetBuildingMaterial (record) {
        record.albedo = '#ff00ff';
        record.albedoTexture = null;
        record.albedoTexturePending = null;
        record.albedoTextureSource = null;
        record.displacementTexture = null;
        record.displacementTexturePending = null;
        record.displacementTextureSource = null;
        record.emission = '#000000';
        record.emissionTexture = null;
        record.emissionTexturePending = null;
        record.emissionTextureSource = null;
        record.normalTexture = null;
        record.normalTexturePending = null;
        record.normalTextureSource = null;
        record.ior = 1.45;
        record.roughness = 1;
        record.roughnessTexture = null;
        record.roughnessTexturePending = null;
        record.roughnessTextureSource = null;
        Object.keys(record.textureVersions).forEach(channel => record.textureVersions[channel]++);
        this.syncBuildingMaterial(record);
    },

    clearBuildingMaterials () {
        for (const record of this.buildingMaterials.values()) {
            this.resetBuildingMaterial(record);
        }
        this.rerenderBuildingScenes();
    },

    addBuildingMaterial (requestedName) {
        const name = this.normalizeBuildingMaterialName(requestedName);
        if (this.buildingMaterials.has(name)) return;
        this.getBuildingMaterialRecord(name);
    },

    getBuildingPrimitive (type, args, material, materialName) {
        if (!(this.buildingPrimitiveCache instanceof Map)) this.buildingPrimitiveCache = new Map();
        const key = JSON.stringify([
            materialName,
            type,
            args.X1,
            args.X2,
            args.Y1,
            args.Y2,
            args.Z1,
            args.Z2,
            args.U1,
            args.U2,
            args.V1,
            args.V2
        ]);
        const cached = this.buildingPrimitiveCache.get(key);
        if (cached) {
            this.buildingPrimitiveCache.delete(key);
            this.buildingPrimitiveCache.set(key, cached);
            return cached;
        }
        const primitive = createBuildingPrimitive(type, {
            x1: args.X1,
            x2: args.X2,
            y1: args.Y1,
            y2: args.Y2,
            z1: args.Z1,
            z2: args.Z2
        }, {
            u1: args.U1,
            u2: args.U2,
            v1: args.V1,
            v2: args.V2
        }, material);
        this.buildingPrimitiveCache.set(key, primitive);
        while (this.buildingPrimitiveCache.size > MAX_BUILDING_PRIMITIVES) {
            this.buildingPrimitiveCache.delete(this.buildingPrimitiveCache.keys().next().value);
        }
        return primitive;
    },

    setBuildingMaterialColor (requestedName, channel, requestedColor) {
        const record = this.getBuildingMaterialRecord(requestedName);
        const textureKey = `${channel}Texture`;
        const pendingKey = `${channel}TexturePending`;
        const sourceKey = `${channel}TextureSource`;
        record[channel] = String(requestedColor || (channel === 'albedo' ? '#ff00ff' : '#000000'));
        record[textureKey] = null;
        record[pendingKey] = null;
        record[sourceKey] = null;
        record.textureVersions[channel]++;
        this.syncBuildingMaterial(record);
        this.rerenderBuildingScenes();
    },

    getCostumeByName (target, requestedCostume) {
        const original = getOriginalTarget(target);
        const costumes = original && typeof original.getCostumes === 'function' ? original.getCostumes() : [];
        if (!costumes.length) return null;
        if (typeof requestedCostume === 'number' || /^\s*\d+\s*$/.test(String(requestedCostume))) {
            return costumes[clamp(Number(requestedCostume) - 1, 0, costumes.length - 1)];
        }
        return costumes.find(costume => costume.name === String(requestedCostume)) || costumes[0];
    },

    getBuildingTexture (costume, channel) {
        const source = costume.asset;
        const usage = channel === 'albedo' || channel === 'emission' ? 'color' : 'data';
        let cachedByUsage = this.buildingTextures.get(source);
        if (!cachedByUsage) {
            cachedByUsage = {};
            this.buildingTextures.set(source, cachedByUsage);
        }
        let cached = cachedByUsage[usage];
        if (cached) return cached;
        cached = {promise: null, texture: null};
        cached.promise = Promise.resolve()
            .then(() => loadBuildingTexture(source.encodeDataURI(), usage === 'color'))
            .then(texture => {
                cached.texture = texture;
                return texture;
            }, error => {
                if (cachedByUsage[usage] === cached) delete cachedByUsage[usage];
                if (!Object.keys(cachedByUsage).length) this.buildingTextures.delete(source);
                throw error;
            });
        cachedByUsage[usage] = cached;
        return cached;
    },

    setBuildingMaterialTexture (requestedName, channel, requestedCostume, target) {
        const record = this.getBuildingMaterialRecord(requestedName);
        const costume = this.getCostumeByName(target, requestedCostume);
        if (!costume || !costume.asset || typeof costume.asset.encodeDataURI !== 'function') return;
        const textureKey = `${channel}Texture`;
        const pendingKey = `${channel}TexturePending`;
        const sourceKey = `${channel}TextureSource`;
        const source = costume.asset;
        if (record[sourceKey] === source && record[textureKey]) return;
        if (record[sourceKey] === source && record[pendingKey]) return record[pendingKey];
        const cached = this.getBuildingTexture(costume, channel);
        const version = ++record.textureVersions[channel];
        record[sourceKey] = source;
        if (cached.texture) {
            record[textureKey] = cached.texture;
            this.syncBuildingMaterial(record);
            this.rerenderBuildingScenes();
            return;
        }
        const pending = cached.promise.then(texture => {
            if (record.textureVersions[channel] !== version || record[sourceKey] !== source) return;
            record[textureKey] = texture;
            this.syncBuildingMaterial(record);
            this.rerenderBuildingScenes();
        });
        const clearPending = () => {
            if (record[pendingKey] === pending) record[pendingKey] = null;
        };
        record[pendingKey] = pending;
        pending.then(clearPending, clearPending);
        return pending;
    },

    renderBuildingPrimitive (type, args, target, render = true, requestedCamera = null) {
        const record = this.getBuildingMaterialRecord(args.MATERIAL);
        const sourceObject = this.getBuildingPrimitive(type, args, record.material, record.name);
        const state = this.getTargetState(target);
        if (state.requestedMode !== 'model') state.renderVersion++;
        state.modelAssetId = null;
        state.modelScene.push({
            materialName: record.name,
            sourceObject,
            transform: this.getModelTransform(target, state)
        });
        state.requestedMode = 'model';
        this.clearPendingVideoFrames(state);
        state.textQueue.length = 0;
        if (render) {
            return requestedCamera ? this.queueModelSceneRender(target, requestedCamera) :
                this.queueModelSceneRender(target);
        }
        return true;
    },

    renderModelToScene (target, requestedModel, render = true, requestedCamera = null) {
        const model = this.getModelByName(target, requestedModel);
        if (!model) return render ? Promise.resolve() : false;
        const state = this.getTargetState(target);
        if (state.requestedMode !== 'model') state.renderVersion++;
        state.modelAssetId = model.assetId;
        state.modelScene.push({
            assetId: model.assetId,
            transform: this.getModelTransform(target, state)
        });
        state.requestedMode = 'model';
        state.textKey = null;
        this.clearPendingVideoFrames(state);
        state.textQueue.length = 0;
        if (render) {
            return requestedCamera ? this.queueModelSceneRender(target, requestedCamera) :
                this.queueModelSceneRender(target);
        }
        return true;
    },

    stampTarget (target) {
        if (!target) return;
        if (typeof this.directPenStamp === 'function') {
            this.directPenStamp(target);
            return;
        }
        const pen = this.runtime.ext_pen;
        if (pen && typeof pen._stamp === 'function') {
            pen._stamp(target);
            return;
        }
        const stamp = this.runtime._primitives && this.runtime._primitives.pen_stamp;
        if (typeof stamp === 'function') stamp({}, {target});
    },

    replaceModelScene (target, requestedModel, requestedCamera = null) {
        const model = this.getModelByName(target, requestedModel);
        if (!model) return Promise.resolve();
        const state = this.getTargetState(target);
        if (state.requestedMode !== 'model') state.renderVersion++;
        state.modelAssetId = model.assetId;
        state.modelScene = [{
            assetId: model.assetId,
            transform: this.getModelTransform(target, state)
        }];
        state.requestedMode = 'model';
        this.clearPendingVideoFrames(state);
        state.textQueue.length = 0;
        const render = requestedCamera ? this.queueModelSceneRender(target, requestedCamera) :
            this.queueModelSceneRender(target);
        return render || Promise.resolve();
    },

    setModelFrame (target, requestedFrame, render = true, requestedCamera = null) {
        const state = this.getTargetState(target);
        const frame = Number(requestedFrame);
        state.modelFrame = Number.isFinite(frame) ? Math.max(1, frame) : 1;
        if (state.requestedMode !== 'model' || !state.modelScene.length) {
            return render ? Promise.resolve() : false;
        }
        if (render) {
            const pending = requestedCamera ? this.queueModelSceneRender(target, requestedCamera) :
                this.queueModelSceneRender(target);
            return pending || Promise.resolve();
        }
        return true;
    },

    // Internal compatibility alias used by project restoration and older UI integrations.
    switchModel (target, requestedModel) {
        return this.replaceModelScene(target, requestedModel);
    },

    queueModelSceneRender (target, requestedCamera = null, preservePenOnly = false) {
        const state = this.getTargetState(target);
        const camera = requestedCamera || cloneCamera(this.camera);
        const penOnly = preservePenOnly && state.penOnly;
        state.modelRenderCamera = camera;
        state.modelRenderVersion++;

        const cachedItems = state.modelScene.map(item => {
            if (item.sourceObject) {
                return {
                    animationName: '',
                    frame: 1,
                    sourceObject: item.sourceObject,
                    transform: {
                        ...item.transform,
                        rotation: {...item.transform.rotation},
                        scale: cloneScale(item.transform.scale)
                    }
                };
            }
            const model = this.getModels(target).find(candidate => candidate.assetId === item.assetId);
            const record = model && this.modelObjects.get(model.assetId);
            if (!record || !record.object) return null;
            return {
                animationName: model.activeMotion,
                frame: state.modelFrame,
                sourceObject: record.object,
                transform: {
                    ...item.transform,
                    rotation: {...item.transform.rotation},
                    scale: cloneScale(item.transform.scale)
                }
            };
        });
        if (cachedItems.length && cachedItems.every(Boolean) && state.requestedMode === 'model') {
            if (!this.modelRenderer) this.modelRenderer = new ModelRenderer();
            const renderArguments = [cachedItems, camera, this.getStageSize(), BITMAP_RESOLUTION];
            if (Array.isArray(this.lights)) renderArguments.push(this.lights);
            const canvas = this.modelRenderer.renderWorldScene(...renderArguments);
            const shouldApplyBitmap = state.modelCanvas !== canvas || this.modelRenderer.lastRenderWasCached !== true;
            if (shouldApplyBitmap) {
                if (penOnly) this.applyBitmap(target, canvas, 'model', null, true);
                else this.applyBitmap(target, canvas, 'model');
                state.modelCanvas = canvas;
            } else {
                this.applyProjection(target);
            }
            this.publishModelZBuffer(target, camera);
            // The scene is already installed. Do not wait for an older queued clear/render request here, or
            // consecutive render-model blocks would expose an empty pen frame between them.
            return;
        }
        if (state.modelRenderPromise) return state.modelRenderPromise;

        const renderPromise = Promise.resolve().then(async () => {
            while (this.targetStates.get(target.id) === state) {
                const version = state.modelRenderVersion;
                const renderCamera = state.modelRenderCamera || camera;
                const sceneItems = state.modelScene.map(item => ({
                    assetId: item.assetId,
                    sourceObject: item.sourceObject,
                    transform: {
                        ...item.transform,
                        rotation: {...item.transform.rotation},
                        scale: cloneScale(item.transform.scale)
                    }
                }));
                const loadedItems = await Promise.all(sceneItems.map(async item => {
                    if (item.sourceObject) {
                        return {
                            animationName: '',
                            frame: 1,
                            sourceObject: item.sourceObject,
                            transform: item.transform
                        };
                    }
                    const model = this.getModels(target).find(candidate => candidate.assetId === item.assetId);
                    if (!model) return null;
                    return {
                        animationName: model.activeMotion,
                        frame: state.modelFrame,
                        sourceObject: await this.getModelObject(model),
                        transform: item.transform
                    };
                }));
                if (this.targetStates.get(target.id) !== state || state.requestedMode !== 'model') return;
                if (state.modelRenderVersion !== version) continue;
                if (!this.modelRenderer) this.modelRenderer = new ModelRenderer();
                const renderArguments = [
                    loadedItems.filter(Boolean),
                    renderCamera,
                    this.getStageSize(),
                    BITMAP_RESOLUTION
                ];
                if (Array.isArray(this.lights)) renderArguments.push(this.lights);
                const canvas = this.modelRenderer.renderWorldScene(...renderArguments);
                const shouldApplyBitmap = state.modelCanvas !== canvas ||
                    this.modelRenderer.lastRenderWasCached !== true;
                if (shouldApplyBitmap) {
                    if (penOnly) this.applyBitmap(target, canvas, 'model', null, true);
                    else this.applyBitmap(target, canvas, 'model');
                    state.modelCanvas = canvas;
                } else {
                    this.applyProjection(target);
                }
                this.publishModelZBuffer(target, renderCamera);
                return;
            }
        });
        state.modelRenderPromise = renderPromise;
        const finish = () => {
            if (state.modelRenderPromise === renderPromise) state.modelRenderPromise = null;
        };
        renderPromise.then(finish, finish);
        return renderPromise;
    },

    nextDepthResourceGeneration () {
        this.depthResourceGeneration = (Number(this.depthResourceGeneration) || 0) + 1;
        return this.depthResourceGeneration;
    },

    createDepthResource (depthBuffer, target = null, options = {}) {
        const targetId = target && target.id ? target.id :
            (typeof target === 'string' ? target : options.targetId);
        return makeDepthResource(depthBuffer, {
            ...options,
            generation: this.nextDepthResourceGeneration(),
            targetId
        });
    },

    getDepthResource (target) {
        const targetId = target && target.id ? target.id : target;
        if (!targetId) return null;
        const state = this.targetStates.get(targetId);
        return state ? state.depthResource || null : null;
    },

    invalidateDepthResources (target = null) {
        if (target) {
            const targetId = target && target.id ? target.id : target;
            const state = this.targetStates.get(targetId);
            if (state) state.depthResource = null;
            return;
        }
        for (const state of this.targetStates.values()) state.depthResource = null;
    },

    publishModelZBuffer (target, camera = null) {
        if (!this.modelRenderer || typeof this.modelRenderer.getDepthBuffer !== 'function') return;
        const depthBuffer = this.modelRenderer.getDepthBuffer();
        if (!depthBuffer) return;
        const published = this.createDepthResource(depthBuffer, target, {
            camera,
            ownerPass: {
                id: target && target.id,
                type: 'target'
            }
        });
        const state = target && this.targetStates.get(target.id);
        if (state) state.depthResource = published;
        return published;
    },

    publishFlatZBuffer (target, requestedCamera = null) {
        if (!target) return;
        const state = this.getTargetState(target);
        const camera = requestedCamera || this.camera || {
            focalLength: DEFAULT_FOCAL_LENGTH,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        };
        const depth = state.ignoreCamera ? state.worldZ : projectPosition({
            x: state.worldX,
            y: state.worldY,
            z: state.worldZ
        }, camera).depth;
        if (!Number.isFinite(depth) || depth <= 0) return;
        this.flatDepthVersion = (Number(this.flatDepthVersion) || 0) + 1;
        const published = this.createDepthResource({
            flatDepth: depth,
            version: this.flatDepthVersion
        }, target, {
            camera,
            ownerPass: {
                id: target.id,
                type: 'target'
            }
        });
        state.depthResource = published;
        return published;
    },

    queueModelRender (target, model) {
        const state = this.getTargetState(target);
        if (state.requestedMode !== 'model') state.renderVersion++;
        state.modelAssetId = model.assetId;
        state.modelScene = [{
            assetId: model.assetId,
            transform: this.getModelTransform(target, state)
        }];
        state.requestedMode = 'model';
        this.clearPendingVideoFrames(state);
        return this.queueModelSceneRender(target) || Promise.resolve();
    },

    renderModel (target, model) {
        return this.queueModelRender(target, model);
    },

    async renderModelPreview (model, canvas, rotation = {x: -15, y: 30, z: 0}) {
        const object = await this.getModelObject(model);
        const renderer = new ModelRenderer(canvas);
        renderer.render(object, {rotation, rotationOrder: 'XYZ'}, {
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        }, model.activeMotion, 1);
        return renderer;
    }
};

export default MovieAssetManagerModelMethods;
