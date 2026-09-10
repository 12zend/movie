import ArgumentType from 'scratch-vm/src/extension-support/argument-type';
import BlockType from 'scratch-vm/src/extension-support/block-type';
import Thread from 'scratch-vm/src/engine/thread';

import {ANIMATION_EASING_TYPES} from './movie-easing';
import {
    FRAME_GRAPH_NODE_TYPES,
    applyObjectTransforms
} from './movie-frame-graph';
import {
    calculateAnimationValue,
    calculateLoopValue,
    calculatePingPongValue,
    calculateWiggleValue,
    evaluateAngleCurve,
    evaluateBezierPath,
    evaluateColorCurve,
    evaluateNumberCurve,
    evaluateStepCurve,
    finiteNumber,
    getAnimationProgress,
    getObjectTime,
    interpolateAngle,
    interpolateColor,
    isTimeWithin,
    posterizeTime
} from './object-animation';

const EXTENSION_ID = 'objects';
const PRIMARY = '#4968D4';
const SECONDARY = '#3E59B8';
const TERTIARY = '#334A99';
const COSTUME_GROUP_SOURCE = 'costume-group';
const DRAW_SOURCES = ['costume', COSTUME_GROUP_SOURCE, 'video', 'text', 'model'];
const SHAPE_TYPES = ['polygon', 'star', 'curved star', 'flower'];
const BLEND_MODES = ['normal', 'add', 'mul', 'screen', 'overlay', 'darken', 'lighten', 'color dodge'];
const MATTE_MODES = ['alpha', 'luma', 'alpha inverted', 'luma inverted'];
const VECTOR_COMPONENTS = ['x', 'y', 'z'];
const TIME_LOOP_MODES = ['loop', 'ping-pong'];
const MAX_REPEAT_COUNT = 512;
const OBJECT_REPORTER_OPCODES = new Set([
    'objects_timelineTime',
    'objects_keyframeTime',
    'objects_leftKeyframeTime',
    'objects_animate',
    'objects_loopValue',
    'objects_pingPongValue',
    'objects_wiggle',
    'objects_timeWithin',
    'objects_posterizeTime',
    'objects_interpolateColor',
    'objects_interpolateAngle',
    'objects_interpolateVector',
    'objects_pass',
    'objects_numberCurve',
    'objects_colorCurve',
    'objects_angleCurve',
    'objects_stepCurve',
    'objects_instanceId',
    'objects_instanceSeed'
]);
const REPORTER_STACK_CLICK_GUARD = '__movieObjectReporterStackClickGuard';
const PROCEDURE_PARAMETER_CONTEXT = '__movieObjectProcedureParameterContext';
const PROCEDURE_PARAMETER_CONTEXT_WRAPPED = '__movieObjectProcedureParameterContextWrapped';
const PROCEDURE_PARAMETER_CONTEXT_PATCH = '__movieObjectProcedureParameterContextPatch';

const encodeDrawAsset = (source, asset) => `${source}:${asset}`;

const decodeDrawAsset = (value, fallbackSource = 'costume') => {
    const stringValue = String(value || '');
    const separator = stringValue.indexOf(':');
    const source = separator > 0 ? stringValue.slice(0, separator) : '';

    if (DRAW_SOURCES.includes(source)) {
        return {
            asset: stringValue.slice(separator + 1),
            source
        };
    }

    return {
        asset: stringValue,
        source: String(fallbackSource || 'costume').toLowerCase()
    };
};

const normalizeShapeType = value => {
    const shape = String(value || '').toLowerCase();
    return SHAPE_TYPES.includes(shape) ? shape : SHAPE_TYPES[0];
};

const normalizeBlendMode = value => {
    const mode = String(value || '').toLowerCase();
    return BLEND_MODES.includes(mode) ? mode : BLEND_MODES[0];
};

const normalizeVectorComponent = value => {
    const component = String(value || '').toLowerCase();
    return VECTOR_COMPONENTS.includes(component) ? component : VECTOR_COMPONENTS[0];
};

const getThreadTimeOffset = util => finiteNumber(util && util.thread && util.thread.objectTimeOffset);

const applyTimeOffset = (time, util) => {
    if (!time) return time;
    const offset = getThreadTimeOffset(util);
    const offsetBoundary = value => (
        Number.isFinite(Number(value)) ? finiteNumber(value) + offset : value
    );
    return {
        start: offsetBoundary(time.start),
        end: offsetBoundary(time.end)
    };
};

const applyThreadComposition = (configuration, util, runtime) => {
    const thread = util && util.thread;
    const manager = runtime && runtime.movieAssetManager;
    const graphCollecting = manager && typeof manager.isCollectingFrameGraph === 'function' &&
        manager.isCollectingFrameGraph();
    const transformed = graphCollecting ? configuration :
        applyObjectTransforms(configuration, thread && thread.objectTransformStack);
    if (!transformed.time) return transformed;
    if (thread && Array.isArray(thread.objectTimeScopes) && thread.objectTimeScopes.length) {
        return {...transformed, evaluationTime: getObjectTime(runtime, util, transformed)};
    }
    return {...transformed, time: applyTimeOffset(transformed.time, util)};
};

const getObjectPlaybackId = util => {
    const thread = util && util.thread;
    const blockId = thread && typeof thread.peekStack === 'function' ? thread.peekStack() : '';
    const instancePath = thread && thread.objectInstancePath;
    return instancePath ? `${blockId}:${instancePath}` : blockId;
};

const hashString = value => {
    let hash = 2166136261;
    const source = String(value || '');
    for (let index = 0; index < source.length; index++) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const getObjectInstanceId = util => {
    const thread = util && util.thread;
    const targetId = util && util.target ? util.target.id : '';
    const blockId = thread && typeof thread.peekStack === 'function' ? thread.peekStack() : '';
    const path = thread && thread.objectInstancePath;
    return [targetId, path || blockId || 'instance'].filter(Boolean).join(':');
};

const removeProcedureParameterContext = (thread, context) => {
    const contexts = thread && thread[PROCEDURE_PARAMETER_CONTEXT];
    if (!Array.isArray(contexts)) return;
    const index = contexts.lastIndexOf(context);
    if (index >= 0) contexts.splice(index, 1);
};

const wrapCompiledProcedure = (thread, procedure, parameterNames) => function (...values) {
    const context = {names: parameterNames, values};
    if (!Array.isArray(thread[PROCEDURE_PARAMETER_CONTEXT])) {
        thread[PROCEDURE_PARAMETER_CONTEXT] = [];
    }
    thread[PROCEDURE_PARAMETER_CONTEXT].push(context);

    let result;
    try {
        result = procedure(...values);
    } catch (error) {
        removeProcedureParameterContext(thread, context);
        throw error;
    }

    if (result && typeof result.next === 'function') {
        return (function* () {
            try {
                return yield* result;
            } finally {
                removeProcedureParameterContext(thread, context);
            }
        }());
    }

    removeProcedureParameterContext(thread, context);
    return result;
};

const getProcedureParameterContext = parentThread => {
    const compiledContexts = parentThread && parentThread[PROCEDURE_PARAMETER_CONTEXT];
    if (Array.isArray(compiledContexts) && compiledContexts.length) {
        const current = compiledContexts[compiledContexts.length - 1];
        const params = {};
        current.names.forEach((name, index) => {
            params[name] = current.values[index];
        });
        return params;
    }

    const stackFrames = parentThread && parentThread.stackFrames;
    if (!Array.isArray(stackFrames)) return null;
    for (let index = stackFrames.length - 1; index >= 0; index--) {
        const frame = stackFrames[index];
        if (frame && frame.params !== null && typeof frame.params === 'object') {
            return {...frame.params};
        }
    }
    return null;
};

const installProcedureParameterFallback = (thread, procedureParams) => {
    if (!thread || !procedureParams || typeof thread.getParam !== 'function') return;

    const getParam = thread.getParam;
    thread.getParam = function (paramName) {
        const value = getParam.call(this, paramName);
        if (value !== null) return value;

        // Scratch reuses a stack frame when a sequential block advances, which clears its params. Keep the
        // grouping's procedure arguments available in that gap, but do not leak them into a nested procedure
        // whose own (possibly empty) parameter frame is active.
        const hasActiveProcedureFrame = Array.isArray(this.stackFrames) && this.stackFrames.some(frame => (
            frame && frame.params !== null
        ));
        if (hasActiveProcedureFrame) return value;
        return Object.prototype.hasOwnProperty.call(procedureParams, paramName) ?
            procedureParams[paramName] : value;
    };
};

const installProcedureParameterContext = () => {
    if (Thread.prototype[PROCEDURE_PARAMETER_CONTEXT_PATCH] ||
        typeof Thread.prototype.tryCompile !== 'function') return;

    const originalTryCompile = Thread.prototype.tryCompile;
    Thread.prototype.tryCompile = function (...args) {
        const result = originalTryCompile.apply(this, args);
        if (!this.isCompiled || this[PROCEDURE_PARAMETER_CONTEXT_WRAPPED]) return result;

        this[PROCEDURE_PARAMETER_CONTEXT] = [];
        const blocks = this.target && this.target.blocks;
        Object.keys(this.procedures || {}).forEach(procedureVariant => {
            const procedure = this.procedures[procedureVariant];
            if (typeof procedure !== 'function') return;
            const procedureCode = procedureVariant.substring(1);
            const metadata = blocks && typeof blocks.getProcedureParamNamesIdsAndDefaults === 'function' ?
                blocks.getProcedureParamNamesIdsAndDefaults(procedureCode) : null;
            const parameterNames = metadata && Array.isArray(metadata[0]) ? metadata[0].slice() : [];
            this.procedures[procedureVariant] = wrapCompiledProcedure(this, procedure, parameterNames);
        });
        this[PROCEDURE_PARAMETER_CONTEXT_WRAPPED] = true;
        return result;
    };
    Thread.prototype[PROCEDURE_PARAMETER_CONTEXT_PATCH] = true;
};

const trackPendingDraw = (pendingDraw, util, manager) => {
    if (!pendingDraw || typeof pendingDraw.then !== 'function') return;
    if (!util || !util.thread) {
        if (manager && typeof manager.runWithoutWaiting === 'function') manager.runWithoutWaiting(pendingDraw);
        return;
    }
    if (!Array.isArray(util.thread.objectPendingDraws)) util.thread.objectPendingDraws = [];
    util.thread.objectPendingDraws.push(pendingDraw);
    const removePending = () => {
        const index = util.thread.objectPendingDraws.indexOf(pendingDraw);
        if (index >= 0) util.thread.objectPendingDraws.splice(index, 1);
    };
    pendingDraw.then(removePending, removePending);
    if (manager && typeof manager.runWithoutWaiting === 'function') manager.runWithoutWaiting(pendingDraw);
};

const getGroupingContext = util => {
    const parentThread = util && util.thread;
    const target = parentThread && parentThread.target;
    const blocks = parentThread && (parentThread.blockContainer || (target && target.blocks));
    const parentBlockId = parentThread && typeof parentThread.peekStack === 'function' ?
        parentThread.peekStack() : null;
    return {
        blocks,
        objectInstancePath: parentThread && parentThread.objectInstancePath,
        objectFrameGraphParent: parentThread && parentThread.objectFrameGraphParent,
        objectSceneCapture: parentThread && parentThread.objectSceneCapture,
        objectSimulationName: parentThread && parentThread.objectSimulationName,
        objectTimeOffset: parentThread && parentThread.objectTimeOffset,
        objectTimeScopes: parentThread && parentThread.objectTimeScopes,
        objectTransformStack: parentThread && parentThread.objectTransformStack,
        parentBlockId,
        procedureParams: getProcedureParameterContext(parentThread),
        target
    };
};

const runGroupingBranch = (runtime, context, branchNumber) => {
    // startBranch(..., true) re-enters a conditional block through the VM's loop path, which yields
    // after every branch in both the interpreter and compiler. Execute the branch as a child warp
    // thread instead so grouping remains atomic without returning a Promise to the parent thread.
    const {blocks, parentBlockId, target} = context;
    const sequencer = runtime && runtime.sequencer;
    const branchId = blocks && typeof blocks.getBranch === 'function' ?
        blocks.getBranch(parentBlockId, branchNumber) : null;
    if (!branchId || !target || !sequencer || typeof sequencer.stepThread !== 'function') return null;

    const branchThread = new Thread(branchId);
    branchThread.target = target;
    branchThread.blockContainer = blocks;
    branchThread.pushStack(branchId);
    branchThread.peekStackFrame().warpMode = true;
    if (context.procedureParams) {
        branchThread.peekStackFrame().params = {...context.procedureParams};
        installProcedureParameterFallback(branchThread, context.procedureParams);
    }
    if (context.objectInstancePath) branchThread.objectInstancePath = context.objectInstancePath;
    if (context.objectFrameGraphParent) branchThread.objectFrameGraphParent = context.objectFrameGraphParent;
    if (context.objectSceneCapture) branchThread.objectSceneCapture = context.objectSceneCapture;
    if (context.objectSimulationName) branchThread.objectSimulationName = context.objectSimulationName;
    if (context.objectTimeOffset) branchThread.objectTimeOffset = context.objectTimeOffset;
    if (Array.isArray(context.objectTimeScopes)) branchThread.objectTimeScopes = context.objectTimeScopes.slice();
    if (Array.isArray(context.objectTransformStack)) {
        branchThread.objectTransformStack = context.objectTransformStack.slice();
    }

    const activeThread = sequencer.activeThread;
    try {
        sequencer.activeThread = branchThread;
        const manager = runtime.movieAssetManager;
        if (context.objectFrameGraphParent && manager && typeof manager.withFrameGraphParent === 'function') {
            manager.withFrameGraphParent(context.objectFrameGraphParent, () => sequencer.stepThread(branchThread));
        } else {
            sequencer.stepThread(branchThread);
        }
    } finally {
        sequencer.activeThread = activeThread;
    }
    return branchThread;
};

const propagatePendingDraws = (branchThread, util, manager) => {
    const pendingDraws = branchThread && Array.isArray(branchThread.objectPendingDraws) ?
        branchThread.objectPendingDraws.slice() : [];
    pendingDraws.forEach(pendingDraw => trackPendingDraw(pendingDraw, util, manager));
    return pendingDraws;
};

const installReporterStackClickGuard = runtime => {
    if (!runtime || typeof runtime._pushThread !== 'function' || runtime[REPORTER_STACK_CLICK_GUARD]) return;
    const originalPushThread = runtime._pushThread;
    runtime._pushThread = function (id, target, options) {
        const blockContainer = target && target.blocks;
        const block = blockContainer && typeof blockContainer.getBlock === 'function' ?
            blockContainer.getBlock(id) : null;
        const isObjectReporterClick = Boolean(
            options && options.stackClick && (
                OBJECT_REPORTER_OPCODES.has(id) ||
                (block && OBJECT_REPORTER_OPCODES.has(block.opcode))
            )
        );
        if (!isObjectReporterClick || !this.compilerOptions || !this.compilerOptions.enabled) {
            return originalPushThread.call(this, id, target, options);
        }

        // TurboWarp's compiler currently treats a stack-clicked extension reporter as a command compatibility
        // node, then rejects its `reporter` block type. Let this one clicked reporter use the interpreter so it
        // can show its value bubble; connected reporters remain compiled compatibility-layer inputs.
        this.compilerOptions.enabled = false;
        try {
            return originalPushThread.call(this, id, target, options);
        } finally {
            this.compilerOptions.enabled = true;
        }
    };
    runtime[REPORTER_STACK_CLICK_GUARD] = true;
};

const createObjectBlocksClass = vm => class ObjectBlocks {
    constructor () {
        this.runtime = vm.runtime;
        this.groupingGeneration = 0;
        this.pendingGrouping = null;
        this.runtime.objectBlocks = this;
        if (this.runtime && typeof this.runtime.on === 'function') {
            this.runtime.on('PROJECT_STOP_ALL', () => this.cancelPendingGroupings());
        }
    }

    cancelPendingGroupings () {
        this.groupingGeneration++;
        this.pendingGrouping = null;
        const manager = this.runtime.movieAssetManager;
        if (manager && typeof manager.discardFrameGraph === 'function') manager.discardFrameGraph();
        const penFX = this.runtime.penFX;
        if (penFX && typeof penFX.cancelGroups === 'function') penFX.cancelGroups();
    }

    createFrameGraphNode (type, properties, context) {
        const manager = this.runtime.movieAssetManager;
        if (!manager || typeof manager.createFrameGraphNode !== 'function') return null;
        return manager.createFrameGraphNode(type, properties, context && context.objectFrameGraphParent);
    }

    getInfo () {
        const numberArgument = defaultValue => ({type: ArgumentType.NUMBER, defaultValue});
        return {
            id: EXTENSION_ID,
            name: 'レイヤー',
            color1: PRIMARY,
            color2: SECONDARY,
            color3: TERTIARY,
            blocks: [
                {
                    opcode: 'draw',
                    blockType: BlockType.COMMAND,
                    text: '描画 [ASSET]',
                    arguments: {
                        SOURCE: {type: ArgumentType.STRING, defaultValue: 'costume'},
                        ASSET: {type: ArgumentType.STRING, defaultValue: ''},
                        TEXT: {type: ArgumentType.STRING, defaultValue: 'Hello!'},
                        VIDEO_MODE: {type: ArgumentType.STRING, defaultValue: 'sequence'},
                        FRAME: numberArgument(1),
                        SPEED: numberArgument(1),
                        VOLUME: numberArgument(100),
                        PX: numberArgument(0),
                        PY: numberArgument(0),
                        PZ: numberArgument(480),
                        RX: numberArgument(0),
                        RY: numberArgument(0),
                        RZ: numberArgument(0),
                        SX: numberArgument(1),
                        SY: numberArgument(1),
                        SZ: numberArgument(1),
                        SIZE: numberArgument(100),
                        WIDTH: numberArgument(100),
                        HEIGHT: numberArgument(100),
                        T1: numberArgument(0),
                        T2: numberArgument(Infinity)
                    }
                },
                {
                    opcode: 'shape',
                    blockType: BlockType.COMMAND,
                    text: '形状 [SHAPE] n: [N] ratio: [RATIO] position x: [PX] y: [PY] z: [PZ] ' +
                        'rotation x: [RX] y: [RY] z: [RZ] scale x: [SX] y: [SY] z: [SZ] ' +
                        'radius: [INNER] [OUTER] width: [WIDTH] height: [HEIGHT] time: [T1] ~ [T2] ' +
                        'color: [COLOR] opacity: [OPACITY] %',
                    arguments: {
                        SHAPE: {type: ArgumentType.STRING, menu: 'shapeType', defaultValue: 'polygon'},
                        N: numberArgument(6),
                        RATIO: numberArgument(0.5),
                        PX: numberArgument(0),
                        PY: numberArgument(0),
                        PZ: numberArgument(480),
                        RX: numberArgument(0),
                        RY: numberArgument(0),
                        RZ: numberArgument(0),
                        SX: numberArgument(1),
                        SY: numberArgument(1),
                        SZ: numberArgument(1),
                        INNER: numberArgument(50),
                        OUTER: numberArgument(100),
                        WIDTH: numberArgument(100),
                        HEIGHT: numberArgument(100),
                        COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'},
                        OPACITY: numberArgument(100),
                        T1: numberArgument(0),
                        T2: numberArgument(Infinity)
                    }
                },
                {
                    opcode: 'arc',
                    blockType: BlockType.COMMAND,
                    text: '円弧 position x: [PX] y: [PY] z: [PZ] ' +
                        'rotation x: [RX] y: [RY] z: [RZ] scale x: [SX] y: [SY] z: [SZ] ' +
                        'radius: [INNER] [OUTER] angle: [START] [END] width: [WIDTH] height: [HEIGHT] ' +
                        'time: [T1] ~ [T2] color: [COLOR] opacity: [OPACITY] %',
                    arguments: {
                        PX: numberArgument(0),
                        PY: numberArgument(0),
                        PZ: numberArgument(480),
                        RX: numberArgument(0),
                        RY: numberArgument(0),
                        RZ: numberArgument(0),
                        SX: numberArgument(1),
                        SY: numberArgument(1),
                        SZ: numberArgument(1),
                        INNER: numberArgument(50),
                        OUTER: numberArgument(100),
                        START: numberArgument(0),
                        END: numberArgument(360),
                        WIDTH: numberArgument(100),
                        HEIGHT: numberArgument(100),
                        COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'},
                        OPACITY: numberArgument(100),
                        T1: numberArgument(0),
                        T2: numberArgument(Infinity)
                    }
                },
                {
                    opcode: 'circularSegment',
                    blockType: BlockType.COMMAND,
                    text: '弓形 position x: [PX] y: [PY] z: [PZ] ' +
                        'rotation x: [RX] y: [RY] z: [RZ] scale x: [SX] y: [SY] z: [SZ] ' +
                        'size: [OUTER] angle: [START] [END] width: [WIDTH] height: [HEIGHT] ' +
                        'time: [T1] ~ [T2] color: [COLOR] opacity: [OPACITY] %',
                    arguments: {
                        PX: numberArgument(0),
                        PY: numberArgument(0),
                        PZ: numberArgument(480),
                        RX: numberArgument(0),
                        RY: numberArgument(0),
                        RZ: numberArgument(0),
                        SX: numberArgument(1),
                        SY: numberArgument(1),
                        SZ: numberArgument(1),
                        OUTER: numberArgument(100),
                        START: numberArgument(0),
                        END: numberArgument(360),
                        WIDTH: numberArgument(100),
                        HEIGHT: numberArgument(100),
                        COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'},
                        OPACITY: numberArgument(100),
                        T1: numberArgument(0),
                        T2: numberArgument(Infinity)
                    }
                },
                {
                    opcode: 'line',
                    blockType: BlockType.COMMAND,
                    text: 'line position1 x: [P1X] y: [P1Y] z: [P1Z] ' +
                        'position2 x: [P2X] y: [P2Y] z: [P2Z] thickness: [THICKNESS] ' +
                        'time: [T1] ~ [T2] color: [COLOR] opacity: [OPACITY] %',
                    arguments: {
                        P1X: numberArgument(0),
                        P1Y: numberArgument(0),
                        P1Z: numberArgument(480),
                        P2X: numberArgument(100),
                        P2Y: numberArgument(100),
                        P2Z: numberArgument(480),
                        THICKNESS: numberArgument(5),
                        COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffffff'},
                        OPACITY: numberArgument(100),
                        T1: numberArgument(0),
                        T2: numberArgument(Infinity)
                    }
                },
                {
                    opcode: 'grouping',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 2,
                    text: ['グループ化', 'エフェクト']
                },
                {
                    opcode: 'scene',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'scene'
                },
                {
                    opcode: 'group',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'group'
                },
                {
                    opcode: 'simulation',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'stateful simulation [NAME]',
                    arguments: {
                        NAME: {type: ArgumentType.STRING, defaultValue: 'simulation'}
                    }
                },
                {
                    opcode: 'transform',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: '移動 position x: [PX] y: [PY] z: [PZ] anchor x: [AX] y: [AY] z: [AZ] ' +
                        'rotation x: [RX] y: [RY] z: [RZ] scale x: [SX] y: [SY] z: [SZ]',
                    arguments: {
                        PX: numberArgument(0),
                        PY: numberArgument(0),
                        PZ: numberArgument(0),
                        AX: numberArgument(0),
                        AY: numberArgument(0),
                        AZ: numberArgument(0),
                        RX: numberArgument(0),
                        RY: numberArgument(0),
                        RZ: numberArgument(0),
                        SX: numberArgument(1),
                        SY: numberArgument(1),
                        SZ: numberArgument(1)
                    }
                },
                {
                    opcode: 'composite',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: '合成 不透明度: [OPACITY] % ブレンド: [BLEND]',
                    arguments: {
                        OPACITY: numberArgument(100),
                        BLEND: {type: ArgumentType.STRING, menu: 'blendMode', defaultValue: 'normal'}
                    }
                },
                {
                    opcode: 'matte',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 2,
                    text: ['matte using [MODE] source', 'matte'],
                    arguments: {
                        MODE: {type: ArgumentType.STRING, menu: 'matteMode', defaultValue: 'alpha'}
                    }
                },
                {
                    opcode: 'renderPass',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'render to pass [NAME]',
                    arguments: {
                        NAME: {type: ArgumentType.STRING, defaultValue: 'pass'}
                    }
                },
                {
                    opcode: 'drawPass',
                    blockType: BlockType.COMMAND,
                    text: 'draw pass [NAME] opacity [OPACITY] % blend [BLEND]',
                    arguments: {
                        NAME: {type: ArgumentType.STRING, defaultValue: 'pass'},
                        OPACITY: numberArgument(100),
                        BLEND: {type: ArgumentType.STRING, menu: 'blendMode', defaultValue: 'normal'}
                    }
                },
                {
                    opcode: 'clearPass',
                    blockType: BlockType.COMMAND,
                    text: 'clear render pass [NAME]',
                    arguments: {
                        NAME: {type: ArgumentType.STRING, defaultValue: 'pass'}
                    }
                },
                {
                    opcode: 'repeat',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'repeat [COUNT] angle offset: [ANGLE] time offset: [TIME] sec',
                    arguments: {
                        COUNT: numberArgument(12),
                        ANGLE: numberArgument(30),
                        TIME: numberArgument(0.05)
                    }
                },
                {
                    opcode: 'timeOffset',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'time offset [TIME] sec',
                    arguments: {
                        TIME: numberArgument(0)
                    }
                },
                {
                    opcode: 'timeRange',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'time range [START] to [END] sec',
                    arguments: {
                        START: numberArgument(0),
                        END: numberArgument(2)
                    }
                },
                {
                    opcode: 'timeScale',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'time speed [SCALE] x',
                    arguments: {
                        SCALE: numberArgument(0.5)
                    }
                },
                {
                    opcode: 'timeLoop',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'time [MODE] every [DURATION] sec',
                    arguments: {
                        MODE: {type: ArgumentType.STRING, menu: 'timeLoopMode', defaultValue: 'loop'},
                        DURATION: numberArgument(2)
                    }
                },
                {
                    opcode: 'timeFreeze',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'freeze time at [TIME] sec',
                    arguments: {
                        TIME: numberArgument(0)
                    }
                },
                {
                    opcode: 'timeReverse',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'reverse time within [DURATION] sec',
                    arguments: {
                        DURATION: numberArgument(2)
                    }
                },
                {
                    opcode: 'timeRemap',
                    blockType: BlockType.CONDITIONAL,
                    branchCount: 1,
                    text: 'remap time [MAP]',
                    arguments: {
                        MAP: {type: ArgumentType.STRING, defaultValue: '0:0; 1:0.8; 2:0.2'}
                    }
                },
                {
                    opcode: 'timelineTime',
                    blockType: BlockType.REPORTER,
                    text: 'timeline time'
                },
                {
                    opcode: 'keyframeTime',
                    blockType: BlockType.REPORTER,
                    text: 'キーフレームの [ID] 番目',
                    arguments: {
                        ID: numberArgument(1)
                    }
                },
                {
                    opcode: 'leftKeyframeTime',
                    blockType: BlockType.REPORTER,
                    text: 'earlier time of keyframes [FIRST] and [SECOND]',
                    arguments: {
                        FIRST: numberArgument(1),
                        SECOND: numberArgument(2)
                    }
                },
                {
                    opcode: 'animate',
                    blockType: BlockType.REPORTER,
                    text: 'animate [A] to [B] from [T1] sec to [T2] sec easing [EASING]',
                    arguments: {
                        A: numberArgument(0),
                        B: numberArgument(100),
                        T1: numberArgument(1),
                        T2: numberArgument(2),
                        EASING: {type: ArgumentType.STRING, menu: 'easing', defaultValue: 'ExpoOut'}
                    }
                },
                {
                    opcode: 'loopValue',
                    blockType: BlockType.REPORTER,
                    text: 'loop [A] to [B] every [DURATION] sec',
                    arguments: {
                        A: numberArgument(0),
                        B: numberArgument(100),
                        DURATION: numberArgument(2)
                    }
                },
                {
                    opcode: 'pingPongValue',
                    blockType: BlockType.REPORTER,
                    text: 'ping-pong [A] to [B] every [DURATION] sec',
                    arguments: {
                        A: numberArgument(0),
                        B: numberArgument(100),
                        DURATION: numberArgument(2)
                    }
                },
                {
                    opcode: 'wiggle',
                    blockType: BlockType.REPORTER,
                    text: 'wiggle frequency [FREQUENCY] amount [AMOUNT] seed [SEED]',
                    arguments: {
                        FREQUENCY: numberArgument(2),
                        AMOUNT: numberArgument(20),
                        SEED: numberArgument(1)
                    }
                },
                {
                    opcode: 'timeWithin',
                    blockType: BlockType.BOOLEAN,
                    text: '[T1] から [T2] まで',
                    arguments: {
                        T1: numberArgument(0),
                        T2: numberArgument(1)
                    }
                },
                {
                    opcode: 'posterizeTime',
                    blockType: BlockType.REPORTER,
                    text: 'posterize time to [FPS] fps',
                    arguments: {
                        FPS: numberArgument(12)
                    }
                },
                {
                    opcode: 'interpolateColor',
                    blockType: BlockType.REPORTER,
                    text: 'interpolate color [A] to [B] from [T1] sec to [T2] sec easing [EASING]',
                    arguments: {
                        A: {type: ArgumentType.COLOR, defaultValue: '#ff3366'},
                        B: {type: ArgumentType.COLOR, defaultValue: '#3366ff'},
                        T1: numberArgument(0),
                        T2: numberArgument(1),
                        EASING: {type: ArgumentType.STRING, menu: 'easing', defaultValue: 'Linear'}
                    }
                },
                {
                    opcode: 'interpolateAngle',
                    blockType: BlockType.REPORTER,
                    text: 'interpolate angle [A] to [B] from [T1] sec to [T2] sec easing [EASING]',
                    arguments: {
                        A: numberArgument(0),
                        B: numberArgument(360),
                        T1: numberArgument(0),
                        T2: numberArgument(1),
                        EASING: {type: ArgumentType.STRING, menu: 'easing', defaultValue: 'Linear'}
                    }
                },
                {
                    opcode: 'interpolateVector',
                    blockType: BlockType.REPORTER,
                    text: 'interpolate vector [COMPONENT] from x: [X1] y: [Y1] z: [Z1] ' +
                        'to x: [X2] y: [Y2] z: [Z2] from [T1] sec to [T2] sec easing [EASING]',
                    arguments: {
                        COMPONENT: {type: ArgumentType.STRING, menu: 'vectorComponent', defaultValue: 'x'},
                        X1: numberArgument(0),
                        Y1: numberArgument(0),
                        Z1: numberArgument(0),
                        X2: numberArgument(100),
                        Y2: numberArgument(100),
                        Z2: numberArgument(100),
                        T1: numberArgument(0),
                        T2: numberArgument(1),
                        EASING: {type: ArgumentType.STRING, menu: 'easing', defaultValue: 'Linear'}
                    }
                },
                {
                    opcode: 'pass',
                    blockType: BlockType.REPORTER,
                    text: 'pass [POINTS] [COMPONENT] [TIME]',
                    arguments: {
                        POINTS: {
                            type: ArgumentType.STRING,
                            defaultValue: ''
                        },
                        COMPONENT: {type: ArgumentType.STRING, menu: 'pathComponent', defaultValue: 'x'},
                        TIME: numberArgument(0)
                    }
                },
                {
                    opcode: 'numberCurve',
                    blockType: BlockType.REPORTER,
                    text: 'number curve [CURVE] at local time',
                    arguments: {
                        CURVE: {type: ArgumentType.STRING, defaultValue: '0:0; 0.4:120@ExpoOut; 1.2:90@BackOut; 2:100'}
                    }
                },
                {
                    opcode: 'colorCurve',
                    blockType: BlockType.REPORTER,
                    text: 'color curve [CURVE] at local time',
                    arguments: {
                        CURVE: {type: ArgumentType.STRING, defaultValue: '0:#ff3366; 1:#3366ff'}
                    }
                },
                {
                    opcode: 'angleCurve',
                    blockType: BlockType.REPORTER,
                    text: 'angle curve [CURVE] at local time',
                    arguments: {
                        CURVE: {type: ArgumentType.STRING, defaultValue: '0:350; 1:10'}
                    }
                },
                {
                    opcode: 'stepCurve',
                    blockType: BlockType.REPORTER,
                    text: 'step curve [CURVE] at local time',
                    arguments: {
                        CURVE: {type: ArgumentType.STRING, defaultValue: '0:one; 1:two'}
                    }
                },
                {
                    opcode: 'instanceId',
                    blockType: BlockType.REPORTER,
                    text: 'component instance id'
                },
                {
                    opcode: 'instanceSeed',
                    blockType: BlockType.REPORTER,
                    text: 'component instance seed [SEED]',
                    arguments: {
                        SEED: numberArgument(1)
                    }
                }
            ],
            menus: {
                blendMode: {
                    acceptReporters: true,
                    items: BLEND_MODES
                },
                easing: {
                    acceptReporters: true,
                    items: ANIMATION_EASING_TYPES
                },
                matteMode: {
                    acceptReporters: true,
                    items: MATTE_MODES
                },
                shapeType: {
                    acceptReporters: true,
                    items: SHAPE_TYPES
                },
                timeLoopMode: {
                    acceptReporters: true,
                    items: TIME_LOOP_MODES
                },
                vectorComponent: {
                    acceptReporters: true,
                    items: VECTOR_COMPONENTS
                },
                pathComponent: {
                    acceptReporters: true,
                    items: ['x', 'y']
                }
            }
        };
    }

    draw (args, util) {
        const selection = decodeDrawAsset(args.ASSET, args.SOURCE);
        const context = applyThreadComposition({
            asset: selection.asset,
            frame: args.FRAME,
            height: args.HEIGHT,
            playbackId: getObjectPlaybackId(util),
            position: {x: args.PX, y: args.PY, z: args.PZ},
            rotation: {x: args.RX, y: args.RY, z: args.RZ},
            scale: {x: args.SX, y: args.SY, z: args.SZ},
            size: args.SIZE,
            source: selection.source,
            speed: args.SPEED,
            text: args.TEXT,
            videoMode: args.VIDEO_MODE,
            volume: args.VOLUME,
            width: args.WIDTH,
            time: Object.prototype.hasOwnProperty.call(args, 'T1') ||
                Object.prototype.hasOwnProperty.call(args, 'T2') ? {start: args.T1, end: args.T2} : null
        }, util, this.runtime);
        if (util && util.thread && util.thread.objectSceneCapture) {
            context.sceneCapture = util.thread.objectSceneCapture;
        }
        if (!context.time) delete context.time;
        const manager = this.runtime.movieAssetManager;
        if (manager && typeof manager.drawObject === 'function') {
            const graphParent = util && util.thread && util.thread.objectFrameGraphParent;
            const pendingDraw = graphParent ? manager.drawObject(util.target, context, graphParent) :
                manager.drawObject(util.target, context);
            trackPendingDraw(pendingDraw, util, manager);
        }
    }

    shape (args, util) {
        const context = applyThreadComposition({
            height: args.HEIGHT,
            n: args.N,
            ratio: args.RATIO,
            playbackId: getObjectPlaybackId(util),
            position: {x: args.PX, y: args.PY, z: args.PZ},
            radius: {inner: args.INNER, outer: args.OUTER},
            rotation: {x: args.RX, y: args.RY, z: args.RZ},
            scale: {x: args.SX, y: args.SY, z: args.SZ},
            shape: normalizeShapeType(args.SHAPE),
            width: args.WIDTH,
            color: args.COLOR,
            opacity: args.OPACITY,
            time: Object.prototype.hasOwnProperty.call(args, 'T1') ||
                Object.prototype.hasOwnProperty.call(args, 'T2') ? {start: args.T1, end: args.T2} : null
        }, util, this.runtime);
        if (util && util.thread && util.thread.objectSceneCapture) {
            context.sceneCapture = util.thread.objectSceneCapture;
        }
        if (!context.time) delete context.time;
        const manager = this.runtime.movieAssetManager;
        if (manager && typeof manager.drawShape === 'function') {
            const graphParent = util && util.thread && util.thread.objectFrameGraphParent;
            const pendingDraw = graphParent ? manager.drawShape(util.target, context, graphParent) :
                manager.drawShape(util.target, context);
            trackPendingDraw(pendingDraw, util, manager);
        }
    }

    drawProceduralShape (shape, args, util, configuration = {}) {
        const context = applyThreadComposition(Object.assign({
            playbackId: getObjectPlaybackId(util),
            shape,
            color: args.COLOR,
            opacity: args.OPACITY,
            time: Object.prototype.hasOwnProperty.call(args, 'T1') ||
                Object.prototype.hasOwnProperty.call(args, 'T2') ? {start: args.T1, end: args.T2} : null
        }, configuration), util, this.runtime);
        if (util && util.thread && util.thread.objectSceneCapture) {
            context.sceneCapture = util.thread.objectSceneCapture;
        }
        if (!context.time) delete context.time;
        const manager = this.runtime.movieAssetManager;
        if (manager && typeof manager.drawShape === 'function') {
            const graphParent = util && util.thread && util.thread.objectFrameGraphParent;
            const pendingDraw = graphParent ? manager.drawShape(util.target, context, graphParent) :
                manager.drawShape(util.target, context);
            trackPendingDraw(pendingDraw, util, manager);
        }
    }

    arc (args, util) {
        this.drawProceduralShape('arc', args, util, {
            height: args.HEIGHT,
            position: {x: args.PX, y: args.PY, z: args.PZ},
            radius: {inner: args.INNER, outer: args.OUTER},
            rotation: {x: args.RX, y: args.RY, z: args.RZ},
            scale: {x: args.SX, y: args.SY, z: args.SZ},
            angle: {start: args.START, end: args.END},
            width: args.WIDTH
        });
    }

    circularSegment (args, util) {
        this.drawProceduralShape('circular segment', args, util, {
            height: args.HEIGHT,
            position: {x: args.PX, y: args.PY, z: args.PZ},
            size: args.OUTER,
            rotation: {x: args.RX, y: args.RY, z: args.RZ},
            scale: {x: args.SX, y: args.SY, z: args.SZ},
            angle: {start: args.START, end: args.END},
            width: args.WIDTH
        });
    }

    line (args, util) {
        this.drawProceduralShape('line', args, util, {
            height: 100,
            position1: {x: args.P1X, y: args.P1Y, z: args.P1Z},
            position2: {x: args.P2X, y: args.P2Y, z: args.P2Z},
            thickness: args.THICKNESS,
            width: 100
        });
    }

    group (args, util) {
        const context = getGroupingContext(util);
        const node = this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.GROUP, {}, context);
        if (node) context.objectFrameGraphParent = node;
        const branchThread = runGroupingBranch(this.runtime, context, 1);
        propagatePendingDraws(branchThread, util, this.runtime.movieAssetManager);
    }

    simulation (args, util) {
        const context = getGroupingContext(util);
        context.objectSimulationName = String(args.NAME || '').trim() || 'simulation';
        const node = this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.GROUP, {
            simulation: context.objectSimulationName
        }, context);
        if (node) context.objectFrameGraphParent = node;
        const branchThread = runGroupingBranch(this.runtime, context, 1);
        propagatePendingDraws(branchThread, util, this.runtime.movieAssetManager);
    }

    transform (args, util) {
        const context = getGroupingContext(util);
        const inherited = Array.isArray(context.objectTransformStack) ? context.objectTransformStack : [];
        const transform = {
            anchor: {x: args.AX, y: args.AY, z: args.AZ},
            position: {x: args.PX, y: args.PY, z: args.PZ},
            rotation: {x: args.RX, y: args.RY, z: args.RZ},
            scale: {x: args.SX, y: args.SY, z: args.SZ}
        };
        context.objectTransformStack = inherited.concat([transform]);
        const node = this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.TRANSFORM, {transform}, context);
        if (node) context.objectFrameGraphParent = node;
        const branchThread = runGroupingBranch(this.runtime, context, 1);
        propagatePendingDraws(branchThread, util, this.runtime.movieAssetManager);
    }

    queueGroupingWork (runGrouping, util) {
        const pendingGrouping = this.pendingGrouping ?
            this.pendingGrouping.then(runGrouping, runGrouping) : runGrouping();
        if (!pendingGrouping || typeof pendingGrouping.then !== 'function') return;

        this.pendingGrouping = pendingGrouping;
        const clearPendingGrouping = () => {
            if (this.pendingGrouping === pendingGrouping) this.pendingGrouping = null;
        };
        pendingGrouping.then(clearPendingGrouping, clearPendingGrouping);
        trackPendingDraw(pendingGrouping, util, this.runtime.movieAssetManager);
    }

    composite (args, util) {
        const context = getGroupingContext(util);
        const generation = this.groupingGeneration;
        const blendMode = normalizeBlendMode(args.BLEND);
        const opacity = Math.max(0, Math.min(1, finiteNumber(args.OPACITY, 100) / 100));
        const node = this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.COMPOSITE, {
            blendMode,
            opacity,
            operation: 'blend'
        }, context);
        if (node) {
            context.objectFrameGraphParent = node;
            runGroupingBranch(this.runtime, context, 1);
            return;
        }
        const runGrouping = () => {
            if (generation !== this.groupingGeneration) return null;
            const penFX = this.runtime.penFX;
            if (penFX && typeof penFX.beginGroup === 'function') penFX.beginGroup();
            const branchThread = runGroupingBranch(this.runtime, context, 1);
            const pendingDraws = branchThread && Array.isArray(branchThread.objectPendingDraws) ?
                branchThread.objectPendingDraws.slice() : [];
            const endGroup = () => {
                if (generation === this.groupingGeneration && penFX && typeof penFX.endGroup === 'function') {
                    penFX.endGroup({blendMode, opacity});
                }
            };
            if (pendingDraws.length) return Promise.all(pendingDraws).finally(endGroup);
            endGroup();
            return null;
        };
        this.queueGroupingWork(runGrouping, util);
    }

    matte (args, util) {
        const context = getGroupingContext(util);
        const generation = this.groupingGeneration;
        const requestedMode = String(args.MODE || '').toLowerCase();
        const mode = MATTE_MODES.includes(requestedMode) ? requestedMode : MATTE_MODES[0];
        const node = this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.COMPOSITE, {
            mode,
            operation: 'matte'
        }, context);
        if (node) {
            const source = this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.GROUP, {role: 'source'}, {
                objectFrameGraphParent: node
            });
            const mask = this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.GROUP, {role: 'mask'}, {
                objectFrameGraphParent: node
            });
            context.objectFrameGraphParent = source;
            runGroupingBranch(this.runtime, context, 1);
            context.objectFrameGraphParent = mask;
            runGroupingBranch(this.runtime, context, 2);
            return;
        }
        const runMatte = () => {
            if (generation !== this.groupingGeneration) return null;
            const penFX = this.runtime.penFX;
            if (!penFX || typeof penFX.beginMatte !== 'function' ||
                typeof penFX.beginMatteMask !== 'function' || typeof penFX.endMatte !== 'function') {
                const sourceThread = runGroupingBranch(this.runtime, context, 1);
                propagatePendingDraws(sourceThread, util, this.runtime.movieAssetManager);
                return null;
            }
            if (penFX.beginMatte() === false) return null;
            const sourceThread = runGroupingBranch(this.runtime, context, 1);
            const sourceDraws = sourceThread && Array.isArray(sourceThread.objectPendingDraws) ?
                sourceThread.objectPendingDraws.slice() : [];
            const runMask = () => {
                if (generation !== this.groupingGeneration) return null;
                if (penFX.beginMatteMask() === false) {
                    penFX.endMatte({mode});
                    return null;
                }
                const maskThread = runGroupingBranch(this.runtime, context, 2);
                const maskDraws = maskThread && Array.isArray(maskThread.objectPendingDraws) ?
                    maskThread.objectPendingDraws.slice() : [];
                const finishMatte = () => {
                    if (generation === this.groupingGeneration) penFX.endMatte({mode});
                };
                if (maskDraws.length) return Promise.all(maskDraws).finally(finishMatte);
                finishMatte();
                return null;
            };
            return sourceDraws.length ? Promise.all(sourceDraws).then(runMask, runMask) : runMask();
        };
        this.queueGroupingWork(runMatte, util);
    }

    renderPass (args, util) {
        const context = getGroupingContext(util);
        const generation = this.groupingGeneration;
        const passName = String(args.NAME || '').trim() || 'pass';
        const node = this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.COMPOSITE, {
            operation: 'render-pass',
            passName
        }, context);
        if (node) {
            context.objectFrameGraphParent = node;
            runGroupingBranch(this.runtime, context, 1);
            return;
        }
        const runPass = () => {
            if (generation !== this.groupingGeneration) return null;
            const penFX = this.runtime.penFX;
            if (!penFX || typeof penFX.beginGroup !== 'function' || typeof penFX.endGroup !== 'function') {
                const branchThread = runGroupingBranch(this.runtime, context, 1);
                propagatePendingDraws(branchThread, util, this.runtime.movieAssetManager);
                return null;
            }
            penFX.beginGroup();
            const branchThread = runGroupingBranch(this.runtime, context, 1);
            const pendingDraws = branchThread && Array.isArray(branchThread.objectPendingDraws) ?
                branchThread.objectPendingDraws.slice() : [];
            const finish = () => {
                if (generation === this.groupingGeneration) {
                    penFX.endGroup({composite: false, passName});
                }
            };
            if (pendingDraws.length) return Promise.all(pendingDraws).finally(finish);
            finish();
            return null;
        };
        this.queueGroupingWork(runPass, util);
    }

    drawPass (args) {
        const manager = this.runtime.movieAssetManager;
        if (manager && typeof manager.enqueueFrameGraphDrawPass === 'function' &&
            manager.enqueueFrameGraphDrawPass(String(args.NAME || '').trim() || 'pass', {
                blendMode: normalizeBlendMode(args.BLEND),
                opacity: Math.max(0, Math.min(1, finiteNumber(args.OPACITY, 100) / 100))
            })) return;
        const penFX = this.runtime.penFX;
        if (!penFX || typeof penFX.drawRenderPass !== 'function') return;
        penFX.drawRenderPass(String(args.NAME || '').trim() || 'pass', {
            blendMode: normalizeBlendMode(args.BLEND),
            opacity: Math.max(0, Math.min(1, finiteNumber(args.OPACITY, 100) / 100))
        });
    }

    clearPass (args) {
        const manager = this.runtime.movieAssetManager;
        if (manager && typeof manager.enqueueFrameGraphClearPass === 'function' &&
            manager.enqueueFrameGraphClearPass(String(args.NAME || '').trim() || 'pass')) return;
        const penFX = this.runtime.penFX;
        if (penFX && typeof penFX.clearRenderPass === 'function') {
            penFX.clearRenderPass(String(args.NAME || '').trim() || 'pass');
        }
    }

    repeat (args, util) {
        const count = Math.min(MAX_REPEAT_COUNT, Math.max(0, Math.floor(Math.abs(finiteNumber(args.COUNT)))));
        const angleOffset = finiteNumber(args.ANGLE);
        const timeOffset = finiteNumber(args.TIME);
        const baseContext = getGroupingContext(util);
        const inheritedTransforms = Array.isArray(baseContext.objectTransformStack) ?
            baseContext.objectTransformStack : [];
        const inheritedTimeOffset = finiteNumber(baseContext.objectTimeOffset);
        const inheritedPath = String(baseContext.objectInstancePath || '');
        for (let index = 0; index < count; index++) {
            const transform = {
                anchor: {x: 0, y: 0, z: 0},
                position: {x: 0, y: 0, z: 0},
                rotation: {x: 0, y: 0, z: angleOffset * index},
                scale: {x: 1, y: 1, z: 1}
            };
            const context = {
                ...baseContext,
                objectInstancePath: inheritedPath ? `${inheritedPath}.${index}` : String(index),
                objectTimeOffset: inheritedTimeOffset + (timeOffset * index),
                objectTransformStack: inheritedTransforms.concat([transform])
            };
            const node = this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.TRANSFORM, {transform}, context);
            if (node) context.objectFrameGraphParent = node;
            const branchThread = runGroupingBranch(this.runtime, context, 1);
            propagatePendingDraws(branchThread, util, this.runtime.movieAssetManager);
        }
    }

    timeOffset (args, util) {
        const context = getGroupingContext(util);
        context.objectTimeOffset = finiteNumber(context.objectTimeOffset) + finiteNumber(args.TIME);
        const branchThread = runGroupingBranch(this.runtime, context, 1);
        propagatePendingDraws(branchThread, util, this.runtime.movieAssetManager);
    }

    runTimeScope (scope, util) {
        const context = getGroupingContext(util);
        const inherited = Array.isArray(context.objectTimeScopes) ? context.objectTimeScopes : [];
        context.objectTimeScopes = inherited.concat([scope]);
        const branchThread = runGroupingBranch(this.runtime, context, 1);
        propagatePendingDraws(branchThread, util, this.runtime.movieAssetManager);
    }

    timeRange (args, util) {
        const start = finiteNumber(args.START);
        const end = finiteNumber(args.END);
        const minimum = Math.min(start, end);
        const maximum = Math.max(start, end);
        const parentTime = getObjectTime(this.runtime, util);
        if (parentTime < minimum || parentTime > maximum) return;
        this.runTimeScope({type: 'range', start: minimum, end: maximum}, util);
    }

    timeScale (args, util) {
        this.runTimeScope({type: 'scale', scale: finiteNumber(args.SCALE, 1)}, util);
    }

    timeLoop (args, util) {
        const mode = String(args.MODE || '').toLowerCase() === 'ping-pong' ? 'pingpong' : 'loop';
        this.runTimeScope({type: mode, duration: Math.abs(finiteNumber(args.DURATION))}, util);
    }

    timeFreeze (args, util) {
        this.runTimeScope({type: 'freeze', time: finiteNumber(args.TIME)}, util);
    }

    timeReverse (args, util) {
        this.runTimeScope({type: 'reverse', duration: Math.abs(finiteNumber(args.DURATION))}, util);
    }

    timeRemap (args, util) {
        this.runTimeScope({type: 'remap', map: args.MAP}, util);
    }

    timelineTime (args, util) {
        return getObjectTime(this.runtime, util);
    }

    keyframeTime (args) {
        const manager = this.runtime && this.runtime.movieAssetManager;
        return manager && typeof manager.getKeyframeTime === 'function' ? manager.getKeyframeTime(args.ID) : 0;
    }

    leftKeyframeTime (args) {
        const manager = this.runtime && this.runtime.movieAssetManager;
        return manager && typeof manager.getLeftKeyframeTime === 'function' ?
            manager.getLeftKeyframeTime(args.FIRST, args.SECOND) : 0;
    }

    animate (args, util) {
        return calculateAnimationValue({
            from: args.A,
            to: args.B,
            start: args.T1,
            end: args.T2,
            easing: args.EASING
        }, getObjectTime(this.runtime, util));
    }

    loopValue (args, util) {
        return calculateLoopValue(args.A, args.B, args.DURATION, getObjectTime(this.runtime, util));
    }

    pingPongValue (args, util) {
        return calculatePingPongValue(args.A, args.B, args.DURATION, getObjectTime(this.runtime, util));
    }

    wiggle (args, util) {
        return calculateWiggleValue(
            args.FREQUENCY,
            args.AMOUNT,
            args.SEED,
            getObjectTime(this.runtime, util)
        );
    }

    timeWithin (args, util) {
        return isTimeWithin(getObjectTime(this.runtime, util), args.T1, args.T2);
    }

    posterizeTime (args, util) {
        return posterizeTime(getObjectTime(this.runtime, util), args.FPS);
    }

    interpolateColor (args, util) {
        const progress = getAnimationProgress({
            start: args.T1,
            end: args.T2,
            easing: args.EASING
        }, getObjectTime(this.runtime, util));
        return interpolateColor(args.A, args.B, progress);
    }

    interpolateAngle (args, util) {
        const progress = getAnimationProgress({
            start: args.T1,
            end: args.T2,
            easing: args.EASING
        }, getObjectTime(this.runtime, util));
        return interpolateAngle(args.A, args.B, progress);
    }

    interpolateVector (args, util) {
        const component = normalizeVectorComponent(args.COMPONENT);
        const suffix = component.toUpperCase();
        return calculateAnimationValue({
            from: args[`${suffix}1`],
            to: args[`${suffix}2`],
            start: args.T1,
            end: args.T2,
            easing: args.EASING
        }, getObjectTime(this.runtime, util));
    }

    pass (args) {
        return evaluateBezierPath(args.POINTS, args.COMPONENT, args.TIME);
    }

    numberCurve (args, util) {
        return evaluateNumberCurve(args.CURVE, getObjectTime(this.runtime, util));
    }

    colorCurve (args, util) {
        return evaluateColorCurve(args.CURVE, getObjectTime(this.runtime, util));
    }

    angleCurve (args, util) {
        return evaluateAngleCurve(args.CURVE, getObjectTime(this.runtime, util));
    }

    stepCurve (args, util) {
        return evaluateStepCurve(args.CURVE, getObjectTime(this.runtime, util));
    }

    instanceId (args, util) {
        return getObjectInstanceId(util);
    }

    instanceSeed (args, util) {
        return (hashString(getObjectInstanceId(util)) ^ Math.trunc(finiteNumber(args.SEED))) >>> 0;
    }

    grouping (args, util) {
        const context = getGroupingContext(util);
        const generation = this.groupingGeneration;
        const node = this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.COMPOSITE, {
            effects: [],
            operation: 'effects'
        }, context);
        if (node) {
            context.objectFrameGraphParent = node;
            runGroupingBranch(this.runtime, context, 1);
            const penFX = this.runtime.penFX;
            if (penFX && typeof penFX.beginEffectCapture === 'function' &&
                typeof penFX.endEffectCapture === 'function') {
                penFX.beginEffectCapture();
                runGroupingBranch(this.runtime, context, 2);
                node.effects = penFX.endEffectCapture();
            } else {
                runGroupingBranch(this.runtime, context, 2);
            }
            return;
        }
        const runGrouping = () => {
            if (generation !== this.groupingGeneration) return null;
            const penFX = this.runtime.penFX;
            if (penFX && typeof penFX.beginGroup === 'function') penFX.beginGroup();
            const objectThread = runGroupingBranch(this.runtime, context, 1);
            const pendingDraws = objectThread && Array.isArray(objectThread.objectPendingDraws) ?
                objectThread.objectPendingDraws.slice() : [];
            if (pendingDraws.length && penFX && typeof penFX.beginEffectCapture === 'function') {
                penFX.beginEffectCapture();
            }
            runGroupingBranch(this.runtime, context, 2);
            if (pendingDraws.length && penFX && typeof penFX.endEffectCapture === 'function') {
                const effects = penFX.endEffectCapture();
                return Promise.all(pendingDraws)
                    .then(() => {
                        if (generation !== this.groupingGeneration) return;
                        if (typeof penFX.applyCapturedEffects === 'function') penFX.applyCapturedEffects(effects);
                    })
                    .finally(() => {
                        if (generation === this.groupingGeneration && typeof penFX.endGroup === 'function') {
                            penFX.endGroup();
                        }
                    });
            }
            if (generation === this.groupingGeneration && penFX && typeof penFX.endGroup === 'function') {
                penFX.endGroup();
            }
            return null;
        };
        // Propagate nested grouping completion to the branch that owns this grouping. Without this, an outer
        // grouping can apply its effects and close the Pen capture before an asynchronous inner video draw is stamped.
        this.queueGroupingWork(runGrouping, util);
    }

    scene (args, util) {
        const manager = this.runtime.movieAssetManager;
        if (!manager || typeof manager.createObjectSceneCapture !== 'function' ||
            typeof manager.renderObjectScene !== 'function') return;
        const context = getGroupingContext(util);
        const node = this.createFrameGraphNode(FRAME_GRAPH_NODE_TYPES.SCENE, {
            sceneKind: 'objects',
            target: context.target
        }, context);
        if (node) {
            context.objectFrameGraphParent = node;
            runGroupingBranch(this.runtime, context, 1);
            return;
        }
        const capture = manager.createObjectSceneCapture(context.target);
        if (!capture) return;
        context.objectSceneCapture = capture;
        runGroupingBranch(this.runtime, context, 1);
        trackPendingDraw(manager.renderObjectScene(context.target, capture), util, manager);
    }
};

const installObjectBlocks = vm => {
    const extensionManager = vm.extensionManager;
    installProcedureParameterContext();
    installReporterStackClickGuard(vm.runtime);
    if (extensionManager.isExtensionLoaded(EXTENSION_ID)) return vm;

    const ObjectBlocks = createObjectBlocksClass(vm);
    extensionManager.addBuiltinExtension(EXTENSION_ID, ObjectBlocks);
    extensionManager.loadExtensionIdSync(EXTENSION_ID);
    return vm;
};

export {
    EXTENSION_ID,
    PRIMARY,
    SECONDARY,
    TERTIARY,
    ANIMATION_EASING_TYPES,
    BLEND_MODES,
    COSTUME_GROUP_SOURCE,
    DRAW_SOURCES,
    MATTE_MODES,
    SHAPE_TYPES,
    TIME_LOOP_MODES,
    applyObjectTransforms,
    encodeDrawAsset,
    decodeDrawAsset,
    normalizeBlendMode,
    normalizeShapeType,
    createObjectBlocksClass,
    installObjectBlocks as default
};
