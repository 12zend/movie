import {
    attachMotionToGLB,
    convertModelToGLB,
    disposeObject,
    loadGLBObject
} from './model-runtime';
import {
    COSTUME_GROUP_SOURCE
} from './movie-asset-manager-constants';
import {
    clamp,
    cloneScale,
    getCostumeAssetId,
    getExtension,
    getModelResourcePath,
    getName,
    getOriginalTarget,
    MODEL_TEXTURE_FORMATS,
    normalizeCostumeGroup,
    readFile,
    unusedName
} from './movie-asset-manager-utils';

const MovieAssetManagerAssetMethods = {
    patchTarget (target) {
        if (!target || target.__movieAssetsPatched) return;
        target.__movieAssetsPatched = true;

        const originalSetCostume = target.setCostume.bind(target);
        const originalSetSize = target.setSize.bind(target);
        const originalSetVisible = target.setVisible.bind(target);
        target.setCostume = index => {
            const result = originalSetCostume(index);
            this.showCostume(target, false);
            return result;
        };
        target.setXY = (x, y, force) => this.setTargetXY(target, x, y, force);
        target.setDirection = direction => this.setLegacyDirection(target, direction);
        target.setSize = size => {
            // Scratch's size fencing clamps the scale based on the costume and stage dimensions.
            // Keep position fencing enabled, but do not let it change an explicitly requested size.
            const runtimeOptions = this.runtime.runtimeOptions;
            const restoreFencing = runtimeOptions && runtimeOptions.fencing;
            if (restoreFencing) runtimeOptions.fencing = false;
            let result;
            try {
                result = originalSetSize(size);
            } finally {
                if (restoreFencing) runtimeOptions.fencing = true;
            }
            this.applyProjection(target);
            this.rerenderTargetModel(target);
            return result;
        };
        target.setVisible = visible => {
            const result = originalSetVisible(visible);
            const state = this.getTargetState(target);
            state.projectionKey = null;
            this.applyProjection(target);
            return result;
        };

        const originalUpdateAll = target.updateAllDrawableProperties.bind(target);
        target.updateAllDrawableProperties = () => {
            const result = originalUpdateAll();
            const state = this.getTargetState(target);
            state.projectionKey = null;
            this.restoreCustomSkin(target);
            this.applyProjection(target);
            return result;
        };
    },

    handleTargetCreated (target) {
        this.patchTarget(target);
        if (!target.isOriginal && target.sprite && target.sprite.clones) {
            const source = target.sprite.clones.find(clone => clone !== target && this.targetStates.has(clone.id));
            if (source) {
                const sourceState = this.getTargetState(source);
                const state = this.getTargetState(target);
                state.worldX = sourceState.worldX;
                state.worldY = sourceState.worldY;
                state.worldZ = sourceState.worldZ;
                state.rotation = {...sourceState.rotation};
                state.scale = cloneScale(sourceState.scale);
                state.rotationOrder = sourceState.rotationOrder;
                state.ignoreCamera = sourceState.ignoreCamera;
                state.modelAssetId = sourceState.modelAssetId;
                state.modelFrame = sourceState.modelFrame;
                state.modelScene = sourceState.modelScene.map(item => ({
                    assetId: item.assetId,
                    transform: {
                        ...item.transform,
                        rotation: {...item.transform.rotation},
                        scale: cloneScale(item.transform.scale)
                    }
                }));
                if (sourceState.mode === 'model') {
                    state.requestedMode = 'model';
                    this.runWithoutWaiting(this.queueModelSceneRender(target));
                }
            }
        }
        this.applyProjection(target);
    },

    handleTargetRemoved (target) {
        this.destroyTargetState(target);
    },

    handleFontsChanged () {
        this.syncFontFaces();
        this.emit('fontsChanged');
    },

    getCostumeGroups (targetOrId) {
        const target = typeof targetOrId === 'string' && this.runtime &&
            typeof this.runtime.getTargetById === 'function' ?
            this.runtime.getTargetById(targetOrId) : targetOrId;
        const original = getOriginalTarget(target);
        const targetId = original && original.id ? original.id : targetOrId;
        if (!(this.costumeGroups instanceof Map)) return [];
        return (this.costumeGroups.get(targetId) || []).map(group => normalizeCostumeGroup(group));
    },

    getCostumeGroupByName (target, requestedGroup) {
        const groups = this.getCostumeGroups(target);
        if (!groups.length) return null;
        if (typeof requestedGroup === 'number' || /^\s*\d+\s*$/.test(String(requestedGroup))) {
            return groups[clamp(Number(requestedGroup) - 1, 0, groups.length - 1)];
        }
        return groups.find(group => group.name === String(requestedGroup)) || null;
    },

    getCostumeGroupCostumes (target, requestedGroup) {
        const resolvedTarget = typeof target === 'string' && this.runtime &&
            typeof this.runtime.getTargetById === 'function' ?
            this.runtime.getTargetById(target) : target;
        const original = getOriginalTarget(resolvedTarget);
        const costumes = original && typeof original.getCostumes === 'function' ? original.getCostumes() : [];
        const group = requestedGroup && typeof requestedGroup === 'object' ?
            normalizeCostumeGroup(requestedGroup) : this.getCostumeGroupByName(target, requestedGroup);
        if (!group || !costumes.length) return [];
        return group.costumeAssetIds.map(assetId => costumes.find(costume => (
            String(costume && costume.assetId) === assetId ||
            (!costume.assetId && String(costume.name) === assetId)
        ))).filter(Boolean);
    },

    getCostumeGroupFrameNumber (group, requestedFrame) {
        const normalized = normalizeCostumeGroup(group);
        const frameCount = normalized.costumeAssetIds.length;
        if (!frameCount) return 1;
        const numericFrame = Number(requestedFrame);
        return Math.round(clamp(Number.isFinite(numericFrame) ? numericFrame : 1, 1, frameCount));
    },

    getCostumeForObjectDraw (target, source, asset, frame) {
        if (source !== COSTUME_GROUP_SOURCE) return this.getCostumeByName(target, asset);
        const group = this.getCostumeGroupByName(target, asset);
        const costumes = this.getCostumeGroupCostumes(target, group);
        return costumes[this.getCostumeGroupFrameNumber(group, frame) - 1] || null;
    },

    getCostumeIndexForObjectDraw (target, costume, fallbackName = null) {
        const original = getOriginalTarget(target);
        const costumes = target && typeof target.getCostumes === 'function' ? target.getCostumes() :
            original && typeof original.getCostumes === 'function' ? original.getCostumes() : [];
        if (costume && costumes.length) {
            const assetIndex = costumes.findIndex(item => item.assetId && item.assetId === costume.assetId);
            if (assetIndex >= 0) return assetIndex;
            const objectIndex = costumes.indexOf(costume);
            if (objectIndex >= 0) return objectIndex;
        }
        if (typeof target.getCostumeIndexByName !== 'function') return -1;
        if (fallbackName !== null) return target.getCostumeIndexByName(String(fallbackName));
        return costume ? target.getCostumeIndexByName(String(costume.name)) : -1;
    },

    createCostumeGroup (targetOrId, requestedCostumeAssetIds, requestedName) {
        const target = typeof targetOrId === 'string' && this.runtime &&
            typeof this.runtime.getTargetById === 'function' ?
            this.runtime.getTargetById(targetOrId) : targetOrId;
        const original = getOriginalTarget(target);
        const costumes = original && typeof original.getCostumes === 'function' ? original.getCostumes() : [];
        if (!original || !costumes.length) return null;

        const requestedIds = Array.from(requestedCostumeAssetIds || []).map(String);
        const costumeAssetIds = Array.from(new Set(requestedIds.map(requestedId => {
            const costume = costumes.find(item => (
                String(item && item.assetId) === requestedId || String(item && item.name) === requestedId
            ));
            return getCostumeAssetId(costume);
        })
            .filter(Boolean)
            .map(String)));
        if (costumeAssetIds.length < 2) return null;

        if (!(this.costumeGroups instanceof Map)) this.costumeGroups = new Map();
        const targetId = original.id;
        const groups = this.getCostumeGroups(original);
        const group = {
            costumeAssetIds,
            name: unusedName(
                String(requestedName || '').trim() || 'Costume group',
                groups.map(item => item.name)
            )
        };
        this.costumeGroups.set(targetId, groups.concat(group));
        this.changedCostumeGroups(targetId);
        return {...group, costumeAssetIds: group.costumeAssetIds.slice()};
    },

    deleteCostumeGroup (targetOrId, index) {
        const target = typeof targetOrId === 'string' && this.runtime &&
            typeof this.runtime.getTargetById === 'function' ?
            this.runtime.getTargetById(targetOrId) : targetOrId;
        const original = getOriginalTarget(target);
        const targetId = original && original.id ? original.id : targetOrId;
        const groups = this.getCostumeGroups(targetId).slice();
        const [removed] = groups.splice(index, 1);
        if (!removed) return false;
        if (!(this.costumeGroups instanceof Map)) this.costumeGroups = new Map();
        this.costumeGroups.set(targetId, groups);
        this.changedCostumeGroups(targetId);
        return true;
    },

    renameCostumeGroup (targetOrId, index, requestedName) {
        const target = typeof targetOrId === 'string' && this.runtime &&
            typeof this.runtime.getTargetById === 'function' ?
            this.runtime.getTargetById(targetOrId) : targetOrId;
        const original = getOriginalTarget(target);
        const targetId = original && original.id ? original.id : targetOrId;
        const groups = this.getCostumeGroups(targetId).slice();
        if (!groups[index]) return '';
        const usedNames = groups.filter((item, itemIndex) => itemIndex !== index).map(item => item.name);
        const name = unusedName(String(requestedName || '').trim() || 'Costume group', usedNames);
        groups[index] = {...groups[index], name};
        if (!(this.costumeGroups instanceof Map)) this.costumeGroups = new Map();
        this.costumeGroups.set(targetId, groups);
        this.changedCostumeGroups(targetId);
        return name;
    },

    removeCostumeFromGroups (targetOrId, assetId) {
        const target = typeof targetOrId === 'string' && this.runtime &&
            typeof this.runtime.getTargetById === 'function' ?
            this.runtime.getTargetById(targetOrId) : targetOrId;
        const original = getOriginalTarget(target);
        const targetId = original && original.id ? original.id : targetOrId;
        const removedId = String(assetId || '');
        const groups = this.getCostumeGroups(targetId);
        const nextGroups = groups.map(group => ({
            ...group,
            costumeAssetIds: group.costumeAssetIds.filter(id => id !== removedId)
        })).filter(group => group.costumeAssetIds.length >= 2);
        if (nextGroups.length === groups.length && nextGroups.every((group, index) => (
            group.name === groups[index].name &&
            group.costumeAssetIds.length === groups[index].costumeAssetIds.length
        ))) return;
        if (!(this.costumeGroups instanceof Map)) this.costumeGroups = new Map();
        this.costumeGroups.set(targetId, nextGroups);
        this.changedCostumeGroups(targetId);
    },

    changedCostumeGroups (targetId) {
        this.emit('costumeGroupsChanged', targetId);
        if (this.runtime && typeof this.runtime.emitProjectChanged === 'function') {
            this.runtime.emitProjectChanged();
        }
        if (this.vm && typeof this.vm.refreshWorkspace === 'function') this.vm.refreshWorkspace();
    },

    getVideos (targetOrId) {
        const target = typeof targetOrId === 'string' ?
            this.runtime.getTargetById(targetOrId) : targetOrId;
        const original = getOriginalTarget(target);
        const targetId = original ? original.id : targetOrId;
        return this.videos.get(targetId) || [];
    },

    getModels (targetOrId) {
        const target = typeof targetOrId === 'string' ?
            this.runtime.getTargetById(targetOrId) : targetOrId;
        const original = getOriginalTarget(target);
        const targetId = original ? original.id : targetOrId;
        return this.models.get(targetId) || [];
    },

    async addModelsFromFiles (targetId, files) {
        const supportedFiles = files.filter(file => ['glb', 'pmx', 'fbx', 'obj', 'mtl'].includes(
            getExtension(file.name)
        ));
        const textureFiles = files.filter(file => MODEL_TEXTURE_FORMATS.includes(getExtension(file.name)));
        const textureData = new Map();
        const readTexture = file => {
            if (!textureData.has(file)) textureData.set(file, readFile(file));
            return textureData.get(file);
        };
        const materialFiles = supportedFiles.filter(file => getExtension(file.name) === 'mtl');
        const sourceFiles = supportedFiles.filter(file => getExtension(file.name) !== 'mtl');
        if (!sourceFiles.length) {
            throw new Error('Choose a GLB, PMX, FBX, or OBJ file. MTL files accompany OBJ files.');
        }

        const added = [];
        for (const file of sourceFiles) {
            const sourceFormat = getExtension(file.name);
            const data = await readFile(file);
            let mtlData = null;
            if (sourceFormat === 'obj') {
                const baseName = getName(file.name).toLowerCase();
                const materialFile = materialFiles.find(item => getName(item.name).toLowerCase() === baseName) ||
                    (materialFiles.length === 1 ? materialFiles[0] : null);
                if (materialFile) mtlData = await readFile(materialFile);
            }
            const textures = sourceFormat === 'pmx' ? await Promise.all(textureFiles.map(async textureFile => ({
                data: await readTexture(textureFile),
                path: getModelResourcePath(textureFile, file),
                type: textureFile.type
            }))) : [];
            const converted = await convertModelToGLB(sourceFormat, data, mtlData, textures);
            const storage = this.runtime.storage;
            const asset = storage.createAsset(
                storage.AssetType.Sound,
                'glb',
                converted.glb,
                null,
                true
            );
            const models = this.getModels(targetId).slice();
            const model = {
                activeMotion: converted.activeMotion,
                animationCount: converted.animationCount,
                asset,
                assetId: asset.assetId,
                dataFormat: 'glb',
                modelFormat: sourceFormat,
                motions: converted.motions,
                name: unusedName(getName(file.name), models.map(item => item.name)),
                originalSize: converted.originalSize,
                sourceFormat,
                triangles: converted.triangles,
                vertices: converted.vertices
            };
            models.push(model);
            this.models.set(targetId, models);
            this.changedModels(targetId);
            added.push(model);
        }
        return added;
    },

    async addModelMotionsFromFiles (targetId, modelIndex, files) {
        const models = this.getModels(targetId).slice();
        let model = models[modelIndex];
        if (!model) throw new Error('Select a model before importing a motion or pose.');
        const motionFiles = files.filter(file => ['vmd', 'vpd'].includes(getExtension(file.name)));
        if (!motionFiles.length) throw new Error('Choose a VMD motion or VPD pose file.');

        for (const file of motionFiles) {
            const format = getExtension(file.name);
            const motionData = await readFile(file);
            const converted = await attachMotionToGLB(model.asset.data, motionData, format, getName(file.name));
            const oldAssetId = model.assetId;
            const asset = this.runtime.storage.createAsset(
                this.runtime.storage.AssetType.Sound,
                'glb',
                converted.glb,
                null,
                true
            );
            const cached = this.modelObjects.get(oldAssetId);
            if (cached && cached.object) disposeObject(cached.object);
            this.modelObjects.delete(oldAssetId);
            model = {
                ...model,
                activeMotion: converted.activeMotion,
                animationCount: converted.animationCount,
                asset,
                assetId: asset.assetId,
                motions: (model.motions || []).concat(converted.motion)
            };
            for (const target of this.runtime.targets) {
                const original = getOriginalTarget(target);
                const state = this.targetStates.get(target.id);
                if (!original || original.id !== targetId || !state) continue;
                state.modelScene.forEach(item => {
                    if (item.assetId === oldAssetId) item.assetId = asset.assetId;
                });
                if (state.modelAssetId === oldAssetId) state.modelAssetId = asset.assetId;
            }
            models[modelIndex] = model;
        }
        this.models.set(targetId, models);
        this.changedModels(targetId);
        this.rerenderModelTargets(targetId);
        return model;
    },

    selectModelMotion (targetId, modelIndex, requestedMotion) {
        const models = this.getModels(targetId).slice();
        const model = models[modelIndex];
        if (!model) return;
        const motions = model.motions || [];
        const motion = motions.find(item => item.name === requestedMotion);
        models[modelIndex] = {
            ...model,
            activeMotion: motion ? motion.name : ''
        };
        this.models.set(targetId, models);
        this.changedModels(targetId);
        this.rerenderModelTargets(targetId);
    },

    rerenderModelTargets (targetId) {
        for (const target of this.runtime.targets) {
            const original = getOriginalTarget(target);
            const state = this.targetStates.get(target.id);
            if (original && original.id === targetId && state && state.mode === 'model') {
                this.runWithoutWaiting(this.queueModelSceneRender(target));
            }
        }
    },

    deleteModel (targetId, index) {
        const models = this.getModels(targetId).slice();
        const [removed] = models.splice(index, 1);
        if (!removed) return;
        this.models.set(targetId, models);
        const cached = this.modelObjects.get(removed.assetId);
        if (cached && cached.object) disposeObject(cached.object);
        this.modelObjects.delete(removed.assetId);
        for (const target of this.runtime.targets) {
            const original = getOriginalTarget(target);
            const state = this.targetStates.get(target.id);
            if (original && original.id === targetId && state) {
                const nextScene = state.modelScene.filter(item => item.assetId !== removed.assetId);
                if (nextScene.length !== state.modelScene.length) {
                    state.modelScene = nextScene;
                    state.modelAssetId = nextScene.length ? nextScene[nextScene.length - 1].assetId : null;
                    if (state.mode === 'model') this.runWithoutWaiting(this.queueModelSceneRender(target));
                }
            }
        }
        this.changedModels(targetId);
    },

    renameModel (targetId, index, requestedName) {
        const models = this.getModels(targetId).slice();
        if (!models[index]) return '';
        const usedNames = models.filter((item, itemIndex) => itemIndex !== index).map(item => item.name);
        const newName = unusedName(requestedName.trim() || 'model', usedNames);
        models[index].name = newName;
        this.models.set(targetId, models);
        this.changedModels(targetId);
        return newName;
    },

    reorderModel (targetId, oldIndex, newIndex) {
        const models = this.getModels(targetId).slice();
        if (!models[oldIndex]) return;
        const [model] = models.splice(oldIndex, 1);
        models.splice(clamp(newIndex, 0, models.length), 0, model);
        this.models.set(targetId, models);
        this.changedModels(targetId);
    },

    changedModels (targetId) {
        this.emit('modelsChanged', targetId);
        this.runtime.emitProjectChanged();
        this.vm.refreshWorkspace();
    },

    getModelByName (target, requestedModel) {
        const models = this.getModels(target);
        if (!models.length) return null;
        if (typeof requestedModel === 'number' || /^\s*\d+\s*$/.test(String(requestedModel))) {
            return models[clamp(Number(requestedModel) - 1, 0, models.length - 1)];
        }
        return models.find(model => model.name === String(requestedModel)) || models[0];
    },

    getModelObject (model) {
        const cached = this.modelObjects.get(model.assetId);
        if (cached) return cached.promise || cached.object;
        const record = {};
        record.promise = loadGLBObject(model.asset.data)
            .then(object => {
                record.object = object;
                record.promise = null;
                return object;
            })
            .catch(error => {
                this.modelObjects.delete(model.assetId);
                throw error;
            });
        this.modelObjects.set(model.assetId, record);
        return record.promise;
    },

    preloadModels () {
        const models = Array.from(this.models.values()).reduce((all, items) => all.concat(items), []);
        return Promise.all(models.map(model => this.getModelObject(model)));
    }
};

export default MovieAssetManagerAssetMethods;
