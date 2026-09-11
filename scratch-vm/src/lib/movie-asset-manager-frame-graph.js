import {
    DEFAULT_BACKDROP_ASSET_ID
} from './movie-asset-manager-constants';
import {createDepthOwner} from './movie-depth-resource';
import installMovieFrameGraphRenderer, {
    applyObjectTransforms,
    FRAME_GRAPH_NODE_TYPES,
    executeSequence
} from './movie-frame-graph';
import {cloneCamera} from './movie-asset-manager-utils';

const THREE_DRAW_KINDS = new Set(['object', 'shape']);

const MovieAssetManagerFrameGraphMethods = {
    installTimelineHats () {
        this.runtime._hats.event_initialize = {
            restartExistingThreads: true
        };
        this.runtime._hats.event_renderframe = {
            restartExistingThreads: true
        };
    },

    isCollectingFrameGraph () {
        return Boolean(this.frameGraphRenderer && this.frameGraphRenderer.collecting);
    },

    ensureFrameGraphRenderer () {
        const renderer = this.runtime.renderer;
        if (this.frameGraphRenderer && this.frameGraphRenderer.renderer === renderer) {
            return this.frameGraphRenderer;
        }
        this.frameGraphRenderer = installMovieFrameGraphRenderer(
            renderer,
            graph => this.renderFrameGraph(graph)
        );
        return this.frameGraphRenderer;
    },

    beginFrameGraph () {
        if (!this.ensureFrameGraphRenderer()) return null;
        return this.frameGraphRenderer.beginFrame({
            timelineFrame: this.timeline && this.timeline.renderFrameIndex,
            timelineTime: this.timeline && this.timeline.currentTime
        });
    },

    createFrameGraphNode (type, properties = {}, parent = null) {
        if (!this.frameGraphRenderer || !this.frameGraphRenderer.collecting) return null;
        const collectionParent = parent ||
            this.frameGraphCollectionParents[this.frameGraphCollectionParents.length - 1];
        const capturesCamera = type === FRAME_GRAPH_NODE_TYPES.DRAW || type === FRAME_GRAPH_NODE_TYPES.SCENE;
        const nodeProperties = capturesCamera ? {
            camera: this.getFrameGraphCameraSnapshot(),
            cameraVersion: this.cameraVersion,
            ...properties
        } : properties;
        return this.frameGraphRenderer.append(type, nodeProperties, collectionParent);
    },

    getFrameGraphCameraSnapshot () {
        if (this.frameGraphCameraSnapshot &&
            this.frameGraphCameraSnapshotVersion === this.cameraVersion) {
            return this.frameGraphCameraSnapshot;
        }
        this.frameGraphCameraSnapshot = cloneCamera(this.camera);
        this.frameGraphCameraSnapshotVersion = this.cameraVersion;
        return this.frameGraphCameraSnapshot;
    },

    createFrameGraphPassContext (context, node) {
        return {
            ...context,
            ownerPass: createDepthOwner(node, context && context.frameId),
            resources: {depth: null}
        };
    },

    setFrameGraphDepthResource (context, resource) {
        if (!context || !context.resources) return;
        context.resources.depth = resource || null;
    },

    claimFrameGraphDepthResource (context, node, target, previousResource) {
        if (!context || !context.resources || !target || typeof this.getDepthResource !== 'function') return;
        if (this.frameGraphRenderer && typeof context.generation === 'number' &&
            this.frameGraphRenderer.generation !== context.generation) return;
        const resource = this.getDepthResource(target);
        if (!resource || resource === previousResource) return;
        this.setFrameGraphDepthResource(context, this.createDepthResource(resource, target, {
            camera: node && node.camera ? node.camera : resource.camera,
            ownerPass: createDepthOwner(node, context.frameId)
        }));
    },

    trackFrameGraphDepthResource (result, context, node, target, previousResource) {
        if (!context || !context.resources) return result;
        const claim = value => {
            this.claimFrameGraphDepthResource(context, node, target, previousResource);
            return value;
        };
        if (result && typeof result.then === 'function') return result.then(claim);
        claim(result);
        return result;
    },

    withFrameGraphParent (parent, callback) {
        if (!parent) return callback();
        this.frameGraphCollectionParents.push(parent);
        try {
            return callback();
        } finally {
            this.frameGraphCollectionParents.pop();
        }
    },

    enqueueFrameGraphDraw (drawKind, target, configuration, parent = null) {
        const node = this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.DRAW, {
            configuration: this.cloneObjectDrawConfiguration(configuration),
            drawKind,
            target
        }, parent);
        return Boolean(node);
    },

    enqueueFrameGraphEffect (effect, parent = null) {
        return Boolean(this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.COMPOSITE, {
            effect,
            operation: 'effect'
        }, parent));
    },

    enqueueFrameGraphDrawPass (passName, options) {
        return Boolean(this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.DRAW, {
            drawKind: 'render-pass',
            options,
            passName
        }));
    },

    enqueueFrameGraphClearPass (passName) {
        return Boolean(this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.COMPOSITE, {
            operation: 'clear-pass',
            passName
        }));
    },

    enqueueFrameGraphPenOperation (drawKind, target = null) {
        return Boolean(this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.DRAW, {
            drawKind,
            target
        }));
    },

    enqueueFrameGraphSceneOperation (operation, target, properties = {}) {
        return Boolean(this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.SCENE, {
            ...properties,
            operation,
            sceneKind: 'mutation',
            target
        }));
    },

    flushFrameGraph () {
        if (!this.frameGraphRenderer) return;
        const render = this.frameGraphRenderer.flush();
        if (!render || typeof render.then !== 'function') return;
        const tracked = Promise.resolve(render);
        this.frameGraphRenderPromise = tracked;
        const clear = () => {
            if (this.frameGraphRenderPromise === tracked) this.frameGraphRenderPromise = null;
        };
        tracked.then(clear, clear);
        this.runWithoutWaiting(tracked);
        return tracked;
    },

    discardFrameGraph () {
        if (this.frameGraphRenderer) this.frameGraphRenderer.discardFrame();
        if (Array.isArray(this.frameGraphCollectionParents)) this.frameGraphCollectionParents.length = 0;
        this.cancelPendingObjectDraws();
        if (typeof this.invalidateDepthResources === 'function') this.invalidateDepthResources();
        this.frameGraphRenderPromise = null;
    },

    finishFrameGraphScope (pending, finish, generation) {
        const finishIfCurrent = () => {
            if (typeof generation !== 'number' || !this.frameGraphRenderer ||
                this.frameGraphRenderer.generation === generation) finish();
        };
        if (!pending || typeof pending.then !== 'function') {
            finishIfCurrent();
            return;
        }
        return pending.then(value => {
            finishIfCurrent();
            return value;
        }, error => {
            finishIfCurrent();
            throw error;
        });
    },

    executeWithFrameGraphCamera (requestedCamera, callback) {
        if (!requestedCamera) return callback();
        const previousCamera = this.camera;
        const renderingCamera = cloneCamera(requestedCamera);
        this.camera = renderingCamera;
        let result;
        try {
            result = callback();
        } catch (error) {
            if (this.camera === renderingCamera) this.camera = previousCamera;
            throw error;
        }
        const restore = value => {
            if (this.camera === renderingCamera) this.camera = previousCamera;
            return value;
        };
        if (result && typeof result.then === 'function') {
            return result.then(restore, error => {
                restore();
                throw error;
            });
        }
        return restore(result);
    },

    executeFrameGraphChildren (node, context) {
        const executionItems = [];
        for (const child of node.children) {
            const previous = executionItems[executionItems.length - 1];
            if (child.type === FRAME_GRAPH_NODE_TYPES.SCENE && child.sceneKind === 'mutation' &&
                previous && previous.sceneBatch && previous.target === child.target &&
                previous.cameraVersion === child.cameraVersion) {
                previous.nodes.push(child);
            } else if (child.type === FRAME_GRAPH_NODE_TYPES.SCENE && child.sceneKind === 'mutation') {
                executionItems.push({
                    cameraVersion: child.cameraVersion,
                    nodes: [child],
                    sceneBatch: true,
                    target: child.target
                });
            } else {
                executionItems.push({node: child});
            }
        }
        return executeSequence(executionItems, item => (
            item.sceneBatch ? this.executeFrameGraphSceneBatch(item.nodes, context) :
                this.executeFrameGraphNode(item.node, context)
        ));
    },

    collectFrameGraphThreeDraws (node, transforms = [], draws = [], analysis = null) {
        // An explicit Objects scene opts its children into one Three.js depth buffer. Ordinary Draw nodes stay on
        // Scratch's existing 2D/Pen path so their color and screen-space text semantics do not change.
        if (node.type === FRAME_GRAPH_NODE_TYPES.DRAW) {
            if (!THREE_DRAW_KINDS.has(node.drawKind)) {
                if (analysis && !analysis.barrier) analysis.barrier = node;
                return null;
            }
            draws.push({
                camera: node.camera,
                cameraVersion: node.cameraVersion,
                configuration: applyObjectTransforms(node.configuration, transforms),
                drawKind: node.drawKind,
                target: node.target
            });
            return draws;
        }
        let childTransforms = transforms;
        if (node.type === FRAME_GRAPH_NODE_TYPES.TRANSFORM) {
            childTransforms = transforms.concat([node.transform]);
        } else if (node.type !== FRAME_GRAPH_NODE_TYPES.GROUP && !(
            node.type === FRAME_GRAPH_NODE_TYPES.SCENE && node.sceneKind === 'objects'
        )) {
            if (analysis && !analysis.barrier) analysis.barrier = node;
            return null;
        }
        for (const child of node.children) {
            const childDraws = this.collectFrameGraphThreeDraws(child, childTransforms, draws, analysis);
            if (!childDraws) return null;
        }
        return draws;
    },

    reportFrameGraphSceneBarrier (scene, barrier) {
        const warning = Object.freeze({
            barrierNodeId: barrier && barrier.id,
            barrierType: barrier && barrier.type,
            code: 'objects-scene-pass-barrier',
            fallback: 'ordered-pen',
            message: 'Objects scene contains an offscreen or non-3D pass; shared depth is unavailable.',
            sceneNodeId: scene && scene.id
        });
        if (!Array.isArray(this.lastFrameGraphWarnings)) this.lastFrameGraphWarnings = [];
        this.lastFrameGraphWarnings.push(warning);
        if (typeof this.emit === 'function') this.emit('frameGraphWarning', warning);
        if (!(this.frameGraphWarningKeys instanceof Set)) this.frameGraphWarningKeys = new Set();
        const warningKey = [warning.code, warning.barrierType, barrier && barrier.operation].join(':');
        if (!this.frameGraphWarningKeys.has(warningKey)) {
            this.frameGraphWarningKeys.add(warningKey);
            console.warn(`[Movie] ${warning.message}`, warning);
        }
        return warning;
    },

    executeFrameGraphDrawBatch (draws, context, node) {
        const first = draws[0];
        if (!first || !first.target) return;
        const capture = this.createObjectSceneCapture(first.target, first.camera);
        if (!capture) return;
        capture.entries = draws.map(draw => ({
            ...draw.configuration,
            movieDrawKind: draw.drawKind
        }));
        const previousResource = this.getDepthResource(first.target);
        const render = this.renderObjectScene(first.target, capture);
        return this.trackFrameGraphDepthResource(render, context, node, first.target, previousResource);
    },

    executeFrameGraphSceneBatch (nodes, context = null) {
        const target = nodes[0] && nodes[0].target;
        if (!target) return;
        const camera = nodes[nodes.length - 1].camera;
        const ownerNode = nodes[nodes.length - 1];
        const previousResource = this.getDepthResource(target);
        const render = this.executeWithFrameGraphCamera(camera, () => {
            let shouldRender = false;
            for (const node of nodes) {
                let changed = false;
                if (node.operation === 'clear-models') changed = this.clearModelScene(target, false);
                if (node.operation === 'render-model') changed = this.renderModelToScene(target, node.model, false);
                if (node.operation === 'set-model-frame') changed = this.setModelFrame(target, node.frame, false);
                if (node.operation === 'render-building') {
                    changed = this.renderBuildingPrimitive(node.primitive, node.arguments, target, false);
                }
                shouldRender = changed === true || shouldRender;
            }
            if (shouldRender) {
                return camera ? this.queueModelSceneRender(target, camera) : this.queueModelSceneRender(target);
            }
        });
        return this.trackFrameGraphDepthResource(render, context, ownerNode, target, previousResource);
    },

    executeFrameGraphComposite (node, context) {
        const penFX = this.penFX || this.runtime.penFX;
        if (node.operation === 'effect') {
            const effect = node.effect;
            if (penFX && effect && typeof penFX.applyCapturedEffects === 'function') {
                penFX.applyCapturedEffects([effect], context);
            }
            return;
        }
        if (node.operation === 'clear-pass') {
            if (penFX && typeof penFX.clearRenderPass === 'function') penFX.clearRenderPass(node.passName);
            return;
        }
        if (node.operation === 'matte') {
            const source = node.children[0];
            const mask = node.children[1];
            const sourceContext = this.createFrameGraphPassContext(context, source || node);
            const maskContext = this.createFrameGraphPassContext(context, mask || node);
            if (!penFX || typeof penFX.beginMatte !== 'function' || penFX.beginMatte() === false) {
                const pendingSource = source ? this.executeFrameGraphNode(source, sourceContext) : null;
                return this.finishFrameGraphScope(pendingSource, () => {
                    this.setFrameGraphDepthResource(context, null);
                }, context.generation);
            }
            const renderSource = source ? this.executeFrameGraphNode(source, sourceContext) : null;
            const renderMask = () => {
                if (this.frameGraphRenderer &&
                    this.frameGraphRenderer.generation !== context.generation) return;
                if (typeof penFX.beginMatteMask !== 'function' || penFX.beginMatteMask() === false) return;
                if (mask) return this.executeFrameGraphNode(mask, maskContext);
            };
            const finish = () => {
                if (typeof penFX.endMatte === 'function') penFX.endMatte({mode: node.mode});
                this.setFrameGraphDepthResource(context, null);
            };
            if (renderSource && typeof renderSource.then === 'function') {
                return this.finishFrameGraphScope(renderSource.then(renderMask), finish, context.generation);
            }
            return this.finishFrameGraphScope(renderMask(), finish, context.generation);
        }
        const passContext = this.createFrameGraphPassContext(context, node);
        if (!penFX || typeof penFX.beginGroup !== 'function') {
            const pendingChildren = this.executeFrameGraphChildren(node, passContext);
            return this.finishFrameGraphScope(pendingChildren, () => {
                this.setFrameGraphDepthResource(context, null);
            }, context.generation);
        }
        penFX.beginGroup();
        const pending = this.executeFrameGraphChildren(node, passContext);
        const finish = () => {
            if (node.operation === 'effects' && typeof penFX.applyCapturedEffects === 'function') {
                penFX.applyCapturedEffects(node.effects, passContext);
            }
            if (typeof penFX.endGroup === 'function') {
                if (node.operation === 'blend') {
                    penFX.endGroup({blendMode: node.blendMode, opacity: node.opacity});
                } else if (node.operation === 'render-pass') {
                    penFX.endGroup({composite: false, passName: node.passName});
                } else {
                    penFX.endGroup();
                }
            }
            if (node.operation !== 'render-pass') this.setFrameGraphDepthResource(context, null);
        };
        return this.finishFrameGraphScope(pending, finish, context.generation);
    },

    executeFrameGraphScene (node, context) {
        if (node.sceneKind === 'frame') return this.executeFrameGraphChildren(node, context);
        if (node.sceneKind === 'objects') {
            const analysis = {barrier: null};
            const draws = this.collectFrameGraphThreeDraws(node, context.transforms, [], analysis);
            if (!draws && analysis.barrier) this.reportFrameGraphSceneBarrier(node, analysis.barrier);
            return draws && draws.length ? this.executeFrameGraphDrawBatch(draws, context, node) :
                this.executeFrameGraphChildren(node, context);
        }
        if (node.sceneKind === 'camera') {
            const cameraRender = this.executeWithFrameGraphCamera(node.camera, () => (
                typeof node.rerenderModels === 'undefined' || node.rerenderModels ?
                    this.applyFrameGraphCamera(node.camera) : this.applyFrameGraphCamera(node.camera, false)
            ));
            return this.finishFrameGraphScope(cameraRender, () => {
                // A camera operation can rerender several independent targets. There is no single coherent depth
                // surface to carry forward until an explicit Scene3D or Draw node establishes one.
                this.setFrameGraphDepthResource(context, null);
            }, context.generation);
        }
        const previousResource = node.target && typeof this.getDepthResource === 'function' ?
            this.getDepthResource(node.target) : null;
        const render = this.executeWithFrameGraphCamera(node.camera, () => {
            if (node.sceneKind === 'mutation') {
                if (node.operation === 'clear-models') return this.clearModelScene(node.target, true, node.camera);
                if (node.operation === 'render-model') {
                    return this.renderModelToScene(node.target, node.model, true, node.camera);
                }
                if (node.operation === 'set-model-frame') {
                    return this.setModelFrame(node.target, node.frame, true, node.camera);
                }
                if (node.operation === 'render-building') {
                    return this.renderBuildingPrimitive(
                        node.primitive,
                        node.arguments,
                        node.target,
                        true,
                        node.camera
                    );
                }
                return;
            }
            return this.executeFrameGraphChildren(node, context);
        });
        if (node.sceneKind === 'mutation') {
            return this.trackFrameGraphDepthResource(render, context, node, node.target, previousResource);
        }
        return render;
    },

    executeFrameGraphDraw (node, context) {
        const previousResource = node.target && typeof this.getDepthResource === 'function' ?
            this.getDepthResource(node.target) : null;
        const render = this.executeWithFrameGraphCamera(node.camera, () => {
            if (node.drawKind === 'pen-clear') {
                this.beginPenFrameTransaction();
                if (typeof this.directPenClear === 'function') this.directPenClear();
                this.drawDefaultPenBackground();
                if (typeof this.invalidateDepthResources === 'function') this.invalidateDepthResources();
                this.setFrameGraphDepthResource(context, null);
                return;
            }
            if (node.drawKind === 'pen-stamp') {
                this.applyProjection(node.target, node.camera);
                this.stampTarget(node.target);
                this.setFrameGraphDepthResource(context, null);
                return;
            }
            if (node.drawKind === 'render-pass') {
                const penFX = this.penFX || this.runtime.penFX;
                if (penFX && typeof penFX.drawRenderPass === 'function') {
                    penFX.drawRenderPass(node.passName, node.options);
                }
                this.setFrameGraphDepthResource(context, null);
                return;
            }
            const configuration = applyObjectTransforms(node.configuration, context.transforms);
            if (node.drawKind === 'shape') {
                return this.drawShapeImmediately(node.target, configuration, node.camera);
            }
            return this.drawObjectImmediately(node.target, configuration, node.camera);
        });
        if (['pen-clear', 'pen-stamp', 'render-pass'].includes(node.drawKind)) return render;
        return this.trackFrameGraphDepthResource(render, context, node, node.target, previousResource);
    },

    executeFrameGraphNode (node, context = {transforms: []}) {
        if (this.frameGraphRenderer && typeof context.generation === 'number' &&
            this.frameGraphRenderer.generation !== context.generation) return;
        if (node.type === FRAME_GRAPH_NODE_TYPES.SCENE) return this.executeFrameGraphScene(node, context);
        if (node.type === FRAME_GRAPH_NODE_TYPES.DRAW) return this.executeFrameGraphDraw(node, context);
        if (node.type === FRAME_GRAPH_NODE_TYPES.COMPOSITE) return this.executeFrameGraphComposite(node, context);
        if (node.type === FRAME_GRAPH_NODE_TYPES.TRANSFORM) {
            return this.executeFrameGraphChildren(node, {
                ...context,
                transforms: context.transforms.concat([node.transform])
            });
        }
        return this.executeFrameGraphChildren(node, context);
    },

    renderFrameGraph (graph) {
        this.lastFrameGraphWarnings = [];
        return this.executeFrameGraphNode(graph, {
            frameId: graph.frameId,
            generation: graph.generation,
            ownerPass: createDepthOwner(graph, graph.frameId),
            resources: {depth: null},
            transforms: []
        });
    },

    attachPenFrameTransactions (penFX) {
        this.penFX = penFX;
        if (this.penFrameTransactionsInstalled) return;
        const pen = this.runtime.ext_pen;
        const primitives = this.runtime._primitives;
        if (!pen || typeof pen.clear !== 'function' || !primitives ||
            typeof primitives.pen_clear !== 'function') return;

        const manager = this;
        const compiledClear = pen.clear;
        this.directPenClear = () => compiledClear.call(pen);
        pen.clear = function (...args) {
            if (manager.enqueueFrameGraphPenOperation('pen-clear')) return;
            manager.beginPenFrameTransaction();
            const result = compiledClear.apply(this, args);
            manager.drawDefaultPenBackground();
            if (typeof manager.invalidateDepthResources === 'function') manager.invalidateDepthResources();
            return result;
        };
        const interpreterClear = primitives.pen_clear;
        primitives.pen_clear = function (...args) {
            if (manager.enqueueFrameGraphPenOperation('pen-clear')) return;
            manager.beginPenFrameTransaction();
            const result = interpreterClear.apply(this, args);
            manager.drawDefaultPenBackground();
            if (typeof manager.invalidateDepthResources === 'function') manager.invalidateDepthResources();
            return result;
        };
        if (typeof pen._stamp === 'function') {
            const compiledStamp = pen._stamp;
            this.directPenStamp = target => compiledStamp.call(pen, target);
            pen._stamp = function (target) {
                if (manager.enqueueFrameGraphPenOperation('pen-stamp', target)) return;
                return compiledStamp.call(this, target);
            };
        }
        if (typeof primitives.pen_stamp === 'function') {
            const interpreterStamp = primitives.pen_stamp;
            primitives.pen_stamp = function (args, util) {
                if (manager.enqueueFrameGraphPenOperation('pen-stamp', util && util.target)) return;
                return interpreterStamp.call(this, args, util);
            };
        }
        this.penFrameTransactionsInstalled = true;
        this.drawDefaultPenBackground();
    },

    usesDefaultBackdrop () {
        const stage = typeof this.runtime.getTargetForStage === 'function' ?
            this.runtime.getTargetForStage() :
            (Array.isArray(this.runtime.targets) ? this.runtime.targets.find(target => target.isStage) : null);
        if (!stage) return false;
        const costumes = typeof stage.getCostumes === 'function' ?
            stage.getCostumes() : stage.sprite && stage.sprite.costumes;
        const costume = Array.isArray(costumes) ? costumes[stage.currentCostume] : null;
        return Boolean(costume && costume.assetId === DEFAULT_BACKDROP_ASSET_ID);
    },

    drawDefaultPenBackground () {
        const renderer = this.runtime.renderer;
        if (!this.defaultStageBackgroundColor) {
            const rendererColor = renderer && renderer._backgroundColor4f;
            this.defaultStageBackgroundColor = rendererColor && rendererColor.length === 4 ?
                Array.from(rendererColor) : [1, 1, 1, 1];
        }
        if (!this.usesDefaultBackdrop()) {
            if (renderer && typeof renderer.setBackgroundColor === 'function') {
                renderer.setBackgroundColor(...this.defaultStageBackgroundColor);
            }
            return;
        }
        if (!this.penFX || typeof this.penFX.drawDefaultBackground !== 'function') return;
        if (renderer && typeof renderer.setBackgroundColor === 'function') {
            renderer.setBackgroundColor(0, 0, 0, 0);
        }
        this.penFX.drawDefaultBackground(this.defaultStageBackgroundColor);
    },

    beginPenFrameTransaction () {
        if (this.penFrameTransactionActive || !this.timeline || !this.timeline.renderedThisStep ||
            !this.penFX || typeof this.penFX.beginFrame !== 'function') return;
        this.penFrameTransactionActive = this.penFX.beginFrame() === true;
    },

    resetPenForRenderFrame () {
        // beginFrame swaps in a transparent staging texture while the completed frame remains visible.
        // This is the render-frame reset: do not call pen_clear from a VM execute hook, because that would
        // expose an empty Pen layer before compiled or interpreted render-frame scripts finish drawing.
        this.beginPenFrameTransaction();
        if (this.penFrameTransactionActive) this.drawDefaultPenBackground();
    },

    commitPenFrameTransaction () {
        if (!this.penFrameTransactionActive) return;
        this.penFrameTransactionActive = false;
        if (this.penFX && typeof this.penFX.commitFrame === 'function') this.penFX.commitFrame();
    },

    cancelPenFrameTransaction () {
        if (!this.penFrameTransactionActive) return;
        this.penFrameTransactionActive = false;
        if (this.penFX && typeof this.penFX.cancelFrame === 'function') this.penFX.cancelFrame();
    },

    cancelPendingObjectDraws () {
        if (!(this.targetStates instanceof Map)) return;
        for (const state of this.targetStates.values()) {
            state.objectDrawVersion++;
            state.objectDrawQueue.length = 0;
        }
    },

    ensureMainTarget () {
        const sprites = this.runtime.targets.filter(target => target.isOriginal && !target.isStage);
        if (!sprites.length) return;
        const target = sprites.find(sprite => sprite.getName() === 'main') || sprites[0];
        if (target.getName() !== 'main') this.vm.renameSprite(target.id, 'main');
        if (!this.vm.editingTarget || this.vm.editingTarget.isStage) this.vm.setEditingTarget(target.id);
    },

    handleProjectLoaded () {
        for (const target of this.runtime.targets) {
            if (!target.isStage) target.setVisible(false);
        }
        this.ensureMainTarget();
        this.drawDefaultPenBackground();
    }
};

export default MovieAssetManagerFrameGraphMethods;
