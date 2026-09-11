import {
    CAMERA_PROJECT_KEY,
    COSTUME_GROUP_PROJECT_KEY,
    MODEL_PROJECT_KEY,
    MIME_TYPES,
    TIMELINE_PROJECT_KEY,
    TRANSFORM_PROJECT_KEY,
    VIDEO_PROJECT_KEY,
    VIDEO_FRAME_RATE
} from './movie-asset-manager-constants';
import {
    cloneCamera,
    cloneScale,
    escapeRegExp,
    getExtension,
    normalizeCostumeGroup,
    normalizeRotationOrder,
    normalizeScale,
    toNumber
} from './movie-asset-manager-utils';
import {
    DEFAULT_DEPTH,
    DEFAULT_FOV,
    focalLengthFromFOV,
    fovFromFocalLength,
    normalizeFOV,
    disposeObject
} from './model-runtime';
import {markMovieProject} from './project-format';

const MovieAssetManagerSerializationMethods = {
    installSerializationHooks () {
        const originalToJSON = this.vm.toJSON.bind(this.vm);
        this.vm.toJSON = (targetId, serializationOptions) => {
            const json = JSON.parse(originalToJSON(targetId, serializationOptions));
            const videos = this.serializeJSON(targetId);
            if (videos.length) json[VIDEO_PROJECT_KEY] = videos;
            const costumeGroups = this.serializeCostumeGroups(targetId);
            if (costumeGroups.length) json[COSTUME_GROUP_PROJECT_KEY] = costumeGroups;
            const models = this.serializeModelsJSON(targetId);
            if (models.length) json[MODEL_PROJECT_KEY] = models;
            if (!this.isDefaultCamera()) json[CAMERA_PROJECT_KEY] = cloneCamera(this.camera);
            json[TIMELINE_PROJECT_KEY] = this.serializeTimeline();
            this.serializeTransforms(json, targetId);
            return JSON.stringify(markMovieProject(json));
        };

        const originalSerializeAssets = this.vm.serializeAssets.bind(this.vm);
        this.vm.serializeAssets = targetId => originalSerializeAssets(targetId).concat(
            this.serializeAssets(targetId),
            this.serializeModelAssets(targetId)
        );

        const originalDeserializeProject = this.vm.deserializeProject.bind(this.vm);
        this.vm.deserializeProject = async (projectJSON, zip) => {
            this.clearRenderingFrames();
            this.lights = null;
            const videoPromise = this.deserializeVideos(projectJSON[VIDEO_PROJECT_KEY], zip);
            const costumeGroups = this.deserializeCostumeGroups(projectJSON[COSTUME_GROUP_PROJECT_KEY]);
            const modelPromise = this.deserializeModels(projectJSON[MODEL_PROJECT_KEY], zip);
            const transformDescriptors = this.readTransformDescriptors(projectJSON);
            const cameraDescriptor = projectJSON[CAMERA_PROJECT_KEY];
            const timelineDescriptor = projectJSON[TIMELINE_PROJECT_KEY];
            const result = await originalDeserializeProject(projectJSON, zip);
            this.replaceVideos(await videoPromise);
            this.replaceCostumeGroups(costumeGroups);
            this.replaceModels(await modelPromise);
            await this.preloadModels();
            this.restoreCamera(cameraDescriptor);
            this.restoreTimeline(timelineDescriptor);
            this.runtime.targets.forEach(target => this.patchTarget(target));
            this.restoreTransforms(transformDescriptors);
            this.applyCamera();
            this.ensureMainTarget();
            return result;
        };
    },

    syncFontFaces () {
        if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) return;
        const fonts = this.runtime.fontManager.getFonts();
        const activeNames = new Set(fonts.filter(font => font.data).map(font => font.name.toLowerCase()));
        for (const [name, record] of this.fontFaces) {
            if (!activeNames.has(name)) {
                document.fonts.delete(record.face);
                this.fontFaces.delete(name);
            }
        }
        for (const font of fonts) {
            if (!font.data || this.fontFaces.has(font.name.toLowerCase())) continue;
            const start = font.data.byteOffset;
            const end = start + font.data.byteLength;
            const data = font.data.buffer.slice(start, end);
            const face = new FontFace(font.name, data);
            document.fonts.add(face);
            const loadPromise = face.load().catch(() => {});
            this.fontFaces.set(font.name.toLowerCase(), {face, loadPromise});
        }
    },

    ensureFontLoaded (fontName) {
        const record = this.fontFaces.get(fontName.toLowerCase());
        if (record) {
            if (record.face.status === 'loaded' || record.face.status === 'error') return null;
            return record.loadPromise;
        }
        if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return null;
        const descriptor = `96px "${fontName}"`;
        if (document.fonts.check && document.fonts.check(descriptor)) return null;
        return document.fonts.load(descriptor).catch(() => {});
    },

    serializeCostumeGroups (targetId) {
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        const result = [];
        if (!(this.costumeGroups instanceof Map)) return result;
        for (const [groupTargetId, groups] of this.costumeGroups) {
            if (targetId && groupTargetId !== targetId) continue;
            const target = originalTargets.find(item => item.id === groupTargetId);
            if (!target) continue;
            for (const group of groups) {
                const normalized = normalizeCostumeGroup(group);
                if (!normalized.name || normalized.costumeAssetIds.length < 2) continue;
                result.push({
                    costumeAssetIds: normalized.costumeAssetIds,
                    isStage: target.isStage,
                    name: normalized.name,
                    targetId: groupTargetId,
                    targetIndex: originalTargets.indexOf(target),
                    targetName: target.getName()
                });
            }
        }
        return result;
    },

    deserializeCostumeGroups (descriptors) {
        if (!Array.isArray(descriptors)) return [];
        return descriptors.map(descriptor => {
            if (!descriptor || typeof descriptor.targetId !== 'string') return null;
            const group = normalizeCostumeGroup(descriptor);
            if (!group.name || group.costumeAssetIds.length < 2) return null;
            return {
                group,
                isStage: descriptor.isStage === true,
                targetId: descriptor.targetId,
                targetIndex: Number.isInteger(descriptor.targetIndex) ? descriptor.targetIndex : -1,
                targetName: typeof descriptor.targetName === 'string' ? descriptor.targetName : ''
            };
        }).filter(Boolean);
    },

    replaceCostumeGroups (entries) {
        if (!(this.costumeGroups instanceof Map)) this.costumeGroups = new Map();
        this.costumeGroups.clear();
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        for (const entry of entries || []) {
            const indexedTarget = originalTargets[entry.targetIndex];
            const target = indexedTarget && indexedTarget.isStage === entry.isStage ? indexedTarget :
                originalTargets.find(item => item.isStage === entry.isStage && item.getName() === entry.targetName);
            const targetId = target ? target.id : entry.targetId;
            const group = normalizeCostumeGroup(entry.group);
            if (!group.name || group.costumeAssetIds.length < 2) continue;
            const groups = this.costumeGroups.get(targetId) || [];
            groups.push(group);
            this.costumeGroups.set(targetId, groups);
        }
        this.emit('costumeGroupsChanged');
    },

    serializeJSON (targetId) {
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        const result = [];
        for (const [videoTargetId, videos] of this.videos) {
            if (targetId && videoTargetId !== targetId) continue;
            const target = originalTargets.find(item => item.id === videoTargetId);
            if (!target) continue;
            for (const video of videos) {
                const bounds = this.getVideoTrimBounds(video);
                result.push({
                    targetId: videoTargetId,
                    targetIndex: originalTargets.indexOf(target),
                    targetName: target.getName(),
                    isStage: target.isStage,
                    name: video.name,
                    md5ext: `${video.assetId}.${video.dataFormat}`,
                    mimeType: video.mimeType,
                    duration: bounds.duration,
                    sourceDuration: bounds.sourceDuration,
                    trimStart: bounds.start,
                    trimEnd: bounds.end,
                    width: video.width,
                    height: video.height,
                    frameRate: video.frameRate
                });
            }
        }
        return result;
    },

    serializeAssets (targetId) {
        const seen = new Set();
        return this.serializeJSON(targetId).reduce((result, descriptor) => {
            if (seen.has(descriptor.md5ext)) return result;
            seen.add(descriptor.md5ext);
            const [assetId] = descriptor.md5ext.split('.');
            const videos = Array.from(this.videos.values()).reduce((all, items) => all.concat(items), []);
            const video = videos.find(item => item.assetId === assetId);
            if (video) {
                result.push({fileName: descriptor.md5ext, fileContent: video.asset.data});
            }
            return result;
        }, []);
    },

    async deserializeVideos (descriptors, zip) {
        if (!Array.isArray(descriptors) || !zip) return [];
        const results = [];
        for (const descriptor of descriptors) {
            if (!descriptor || typeof descriptor.md5ext !== 'string' || typeof descriptor.targetId !== 'string') {
                continue;
            }
            let file = zip.file(descriptor.md5ext);
            if (!file) {
                const pattern = new RegExp(`^([^/]*/)?${escapeRegExp(descriptor.md5ext)}$`);
                file = zip.file(pattern)[0];
            }
            if (!file) continue;
            const data = await file.async('uint8array');
            const dataFormat = getExtension(descriptor.md5ext);
            const assetId = descriptor.md5ext.slice(0, -(dataFormat.length + 1));
            const asset = this.runtime.storage.createAsset(
                this.runtime.storage.AssetType.Sound,
                dataFormat,
                data,
                assetId,
                false
            );
            const mimeType = descriptor.mimeType || MIME_TYPES[dataFormat] || 'video/mp4';
            const url = URL.createObjectURL(new Blob([data], {type: mimeType}));
            const sourceDuration = Number(descriptor.sourceDuration) >= 0 ?
                Number(descriptor.sourceDuration) : Number(descriptor.duration) || 0;
            const trimStart = Math.min(
                Math.max(0, Number(descriptor.trimStart) || 0),
                sourceDuration
            );
            const trimEnd = Math.min(
                Math.max(trimStart, Number(descriptor.trimEnd) >= 0 ? Number(descriptor.trimEnd) : sourceDuration),
                sourceDuration
            );
            results.push({
                isStage: descriptor.isStage === true,
                targetIndex: Number.isInteger(descriptor.targetIndex) ? descriptor.targetIndex : -1,
                targetName: typeof descriptor.targetName === 'string' ? descriptor.targetName : '',
                targetId: descriptor.targetId,
                video: {
                    asset,
                    assetId,
                    dataFormat,
                    duration: Math.max(0, trimEnd - trimStart),
                    frameRate: Number(descriptor.frameRate) || VIDEO_FRAME_RATE,
                    height: Number(descriptor.height) || 0,
                    mimeType,
                    name: String(descriptor.name || 'video'),
                    sourceDuration,
                    trimEnd,
                    trimStart,
                    url,
                    width: Number(descriptor.width) || 0
                }
            });
        }
        return results;
    },

    replaceVideos (entries) {
        for (const videos of this.videos.values()) {
            videos.forEach(video => URL.revokeObjectURL(video.url));
        }
        this.videos.clear();
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        for (const entry of entries) {
            // Scratch target IDs are regenerated whenever a project is loaded. Resolve the
            // saved target by its serialized position, with name/type as a compatibility fallback.
            const indexedTarget = originalTargets[entry.targetIndex];
            const target = indexedTarget && indexedTarget.isStage === entry.isStage ? indexedTarget :
                originalTargets.find(item => item.isStage === entry.isStage && item.getName() === entry.targetName);
            const targetId = target ? target.id : entry.targetId;
            const videos = this.videos.get(targetId) || [];
            videos.push(entry.video);
            this.videos.set(targetId, videos);
        }
        this.emit('videosChanged');
    },

    isDefaultCamera () {
        const [width, height] = this.getStageSize();
        const defaultFocalLength = focalLengthFromFOV(DEFAULT_FOV, width, height);
        return Math.abs(this.camera.fov - DEFAULT_FOV) < 1e-9 &&
            Math.abs(this.camera.focalLength - defaultFocalLength) < 1e-9 &&
            this.camera.position.x === 0 && this.camera.position.y === 0 && this.camera.position.z === 0 &&
            this.camera.rotation.x === 0 && this.camera.rotation.y === 0 && this.camera.rotation.z === 0 &&
            this.camera.rotationOrder === 'XYZ';
    },

    serializeTransforms (json, targetId) {
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        const serializedTargets = Array.isArray(json.targets) ? json.targets : [json];
        const selectedTargets = targetId ? originalTargets.filter(target => target.id === targetId) : originalTargets;
        selectedTargets.forEach((target, index) => {
            if (target.isStage) return;
            const state = this.targetStates.get(target.id);
            if (!state) return;
            const modelScene = state.mode === 'model' ? state.modelScene.map(item => {
                const model = this.getModels(target).find(candidate => candidate.assetId === item.assetId);
                if (!model) return null;
                return {
                    model: model.name,
                    transform: {
                        ...item.transform,
                        rotation: {...item.transform.rotation},
                        scale: cloneScale(item.transform.scale)
                    }
                };
            }).filter(Boolean) : [];
            const selectedModel = modelScene.length === 1 ? modelScene[0].model : null;
            const isDefault = state.worldZ === DEFAULT_DEPTH && state.rotation.x === 0 && state.rotation.y === 0 &&
                state.rotationOrder === 'XYZ' && !state.ignoreCamera &&
                normalizeScale(state.scale && state.scale.x) === 1 &&
                normalizeScale(state.scale && state.scale.y) === 1 &&
                normalizeScale(state.scale && state.scale.z) === 1 && !modelScene.length;
            if (isDefault) return;
            const serializedTarget = serializedTargets[index];
            if (!serializedTarget) return;
            serializedTarget[TRANSFORM_PROJECT_KEY] = {
                rotation: {...state.rotation},
                rotationOrder: state.rotationOrder,
                scale: cloneScale(state.scale),
                scene: modelScene,
                ignoreCamera: state.ignoreCamera,
                z: state.worldZ,
                model: selectedModel
            };
        });
    },

    readTransformDescriptors (projectJSON) {
        const targets = Array.isArray(projectJSON.targets) ? projectJSON.targets : [projectJSON];
        return targets.map((target, targetIndex) => ({
            isStage: target.isStage === true,
            targetIndex,
            targetName: String(target.name || ''),
            transform: target[TRANSFORM_PROJECT_KEY]
        })).filter(item => item.transform && typeof item.transform === 'object');
    },

    restoreTransforms (descriptors) {
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        for (const descriptor of descriptors) {
            const indexedTarget = originalTargets[descriptor.targetIndex];
            const target = indexedTarget && indexedTarget.isStage === descriptor.isStage ? indexedTarget :
                originalTargets.find(item => (
                    item.isStage === descriptor.isStage && item.getName() === descriptor.targetName
                ));
            if (!target || target.isStage) continue;
            const state = this.getTargetState(target);
            const transform = descriptor.transform;
            state.ignoreCamera = transform.ignoreCamera === true;
            state.worldX = target.x;
            state.worldY = target.y;
            state.worldZ = toNumber(transform.z, DEFAULT_DEPTH);
            state.rotation = {
                x: toNumber(transform.rotation && transform.rotation.x),
                y: toNumber(transform.rotation && transform.rotation.y),
                z: toNumber(transform.rotation && transform.rotation.z, 90 - target.direction)
            };
            state.scale = cloneScale(transform.scale);
            state.rotationOrder = normalizeRotationOrder(transform.rotationOrder);
            target.direction = 90 - state.rotation.z;
            this.applyProjection(target);
            if (Array.isArray(transform.scene)) {
                state.modelScene = transform.scene.map(item => {
                    const model = this.getModelByName(target, item && item.model);
                    if (!model) return null;
                    const savedTransform = item.transform || {};
                    return {
                        assetId: model.assetId,
                        transform: {
                            rotation: {
                                x: toNumber(savedTransform.rotation && savedTransform.rotation.x),
                                y: toNumber(savedTransform.rotation && savedTransform.rotation.y),
                                z: toNumber(savedTransform.rotation && savedTransform.rotation.z)
                            },
                            rotationOrder: normalizeRotationOrder(savedTransform.rotationOrder),
                            scale: cloneScale(savedTransform.scale),
                            size: Math.max(0, toNumber(savedTransform.size, 100)),
                            worldX: toNumber(savedTransform.worldX),
                            worldY: toNumber(savedTransform.worldY),
                            worldZ: toNumber(savedTransform.worldZ, DEFAULT_DEPTH)
                        }
                    };
                }).filter(Boolean);
                if (state.modelScene.length) {
                    state.modelAssetId = state.modelScene[state.modelScene.length - 1].assetId;
                    if (state.requestedMode !== 'model') state.renderVersion++;
                    state.requestedMode = 'model';
                    this.clearPendingVideoFrames(state);
                    this.runWithoutWaiting(this.queueModelSceneRender(target));
                }
            } else if (transform.model) {
                this.runWithoutWaiting(this.switchModel(target, transform.model));
            }
        }
    },

    restoreCamera (descriptor) {
        const [width, height] = this.getStageSize();
        const savedFocalLength = Math.max(
            0.001,
            toNumber(descriptor && descriptor.focalLength, focalLengthFromFOV(DEFAULT_FOV, width, height))
        );
        const fov = descriptor && typeof descriptor.fov !== 'undefined' ?
            normalizeFOV(descriptor.fov) : fovFromFocalLength(savedFocalLength, width, height);
        this.camera = {
            fov,
            focalLength: descriptor && typeof descriptor.fov !== 'undefined' ?
                focalLengthFromFOV(fov, width, height) : savedFocalLength,
            position: {
                x: toNumber(descriptor && descriptor.position && descriptor.position.x),
                y: toNumber(descriptor && descriptor.position && descriptor.position.y),
                z: toNumber(descriptor && descriptor.position && descriptor.position.z)
            },
            rotation: {
                x: toNumber(descriptor && descriptor.rotation && descriptor.rotation.x),
                y: toNumber(descriptor && descriptor.rotation && descriptor.rotation.y),
                z: toNumber(descriptor && descriptor.rotation && descriptor.rotation.z)
            },
            rotationOrder: normalizeRotationOrder(descriptor && descriptor.rotationOrder)
        };
    },

    serializeModelsJSON (targetId) {
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        const result = [];
        for (const [modelTargetId, models] of this.models) {
            if (targetId && modelTargetId !== targetId) continue;
            const target = originalTargets.find(item => item.id === modelTargetId);
            if (!target) continue;
            for (const model of models) {
                result.push({
                    activeMotion: model.activeMotion || '',
                    animationCount: model.animationCount,
                    isStage: target.isStage,
                    md5ext: `${model.assetId}.glb`,
                    modelFormat: model.modelFormat || model.sourceFormat || 'glb',
                    motions: (model.motions || []).map(motion => ({...motion})),
                    name: model.name,
                    originalSize: model.originalSize,
                    sourceFormat: model.sourceFormat,
                    targetId: modelTargetId,
                    targetIndex: originalTargets.indexOf(target),
                    targetName: target.getName(),
                    triangles: model.triangles,
                    vertices: model.vertices
                });
            }
        }
        return result;
    },

    serializeModelAssets (targetId) {
        const seen = new Set();
        const allModels = Array.from(this.models.values()).reduce((all, items) => all.concat(items), []);
        return this.serializeModelsJSON(targetId).reduce((result, descriptor) => {
            if (seen.has(descriptor.md5ext)) return result;
            seen.add(descriptor.md5ext);
            const assetId = descriptor.md5ext.slice(0, -4);
            const model = allModels.find(item => item.assetId === assetId);
            if (model) result.push({fileName: descriptor.md5ext, fileContent: model.asset.data});
            return result;
        }, []);
    },

    async deserializeModels (descriptors, zip) {
        if (!Array.isArray(descriptors) || !zip) return [];
        const results = [];
        for (const descriptor of descriptors) {
            if (!descriptor || typeof descriptor.md5ext !== 'string') continue;
            let file = zip.file(descriptor.md5ext);
            if (!file) {
                const pattern = new RegExp(`^([^/]*/)?${escapeRegExp(descriptor.md5ext)}$`);
                file = zip.file(pattern)[0];
            }
            if (!file) continue;
            const data = await file.async('uint8array');
            const assetId = descriptor.md5ext.slice(0, -4);
            const asset = this.runtime.storage.createAsset(
                this.runtime.storage.AssetType.Sound,
                'glb',
                data,
                assetId,
                false
            );
            results.push({
                isStage: descriptor.isStage === true,
                model: {
                    activeMotion: String(descriptor.activeMotion || ''),
                    animationCount: toNumber(descriptor.animationCount),
                    asset,
                    assetId,
                    dataFormat: 'glb',
                    modelFormat: String(descriptor.modelFormat || descriptor.sourceFormat || 'glb'),
                    motions: Array.isArray(descriptor.motions) ? descriptor.motions.map(motion => ({
                        format: String(motion.format || ''),
                        frameCount: Math.max(1, toNumber(motion.frameCount, 1)),
                        name: String(motion.name || '')
                    })).filter(motion => motion.name) : [],
                    name: String(descriptor.name || 'model'),
                    originalSize: descriptor.originalSize || {x: 0, y: 0, z: 0},
                    sourceFormat: String(descriptor.sourceFormat || 'glb'),
                    triangles: toNumber(descriptor.triangles),
                    vertices: toNumber(descriptor.vertices)
                },
                targetId: String(descriptor.targetId || ''),
                targetIndex: Number.isInteger(descriptor.targetIndex) ? descriptor.targetIndex : -1,
                targetName: String(descriptor.targetName || '')
            });
        }
        return results;
    },

    replaceModels (entries) {
        for (const record of this.modelObjects.values()) {
            if (record.object) disposeObject(record.object);
        }
        this.modelObjects.clear();
        this.models.clear();
        const originalTargets = this.runtime.targets.filter(target => target.isOriginal);
        for (const entry of entries) {
            const indexedTarget = originalTargets[entry.targetIndex];
            const target = indexedTarget && indexedTarget.isStage === entry.isStage ? indexedTarget :
                originalTargets.find(item => item.isStage === entry.isStage && item.getName() === entry.targetName);
            const targetId = target ? target.id : entry.targetId;
            const models = this.models.get(targetId) || [];
            models.push(entry.model);
            this.models.set(targetId, models);
        }
        this.emit('modelsChanged');
    }
};

export default MovieAssetManagerSerializationMethods;
