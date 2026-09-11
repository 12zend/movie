const FRAME_GRAPH_NODE_TYPES = Object.freeze({
    COMPOSITE: 'Composite',
    DRAW: 'Draw',
    GROUP: 'Group',
    SCENE: 'Scene',
    TRANSFORM: 'Transform'
});

const VALID_NODE_TYPES = new Set(Object.keys(FRAME_GRAPH_NODE_TYPES).map(key => FRAME_GRAPH_NODE_TYPES[key]));

const isPromise = value => Boolean(value && typeof value.then === 'function');

const finiteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const rotationCache = new WeakMap();

const rotatePoint = (point, rotation) => {
    const xRotation = finiteNumber(rotation && rotation.x) * Math.PI / 180;
    const yRotation = finiteNumber(rotation && rotation.y) * Math.PI / 180;
    const zRotation = finiteNumber(rotation && rotation.z) * Math.PI / 180;
    let {x, y, z} = point;

    let cached = rotation && typeof rotation === 'object' ? rotationCache.get(rotation) : null;
    if (!cached || cached.x !== xRotation || cached.y !== yRotation || cached.z !== zRotation) {
        cached = {
            x: xRotation,
            y: yRotation,
            z: zRotation,
            xCosine: Math.cos(xRotation),
            xSine: Math.sin(xRotation),
            yCosine: Math.cos(yRotation),
            ySine: Math.sin(yRotation),
            zCosine: Math.cos(zRotation),
            zSine: Math.sin(zRotation)
        };
        if (rotation && typeof rotation === 'object') rotationCache.set(rotation, cached);
    }
    const {xCosine, xSine, yCosine, ySine, zCosine, zSine} = cached;
    [y, z] = [(y * xCosine) - (z * xSine), (y * xSine) + (z * xCosine)];
    [x, z] = [(x * yCosine) + (z * ySine), (-x * ySine) + (z * yCosine)];
    [x, y] = [(x * zCosine) - (y * zSine), (x * zSine) + (y * zCosine)];
    return {x, y, z};
};

const transformPoint = (point, transform) => {
    const source = point || {};
    const anchor = transform.anchor || {};
    const scale = transform.scale || {};
    const rotated = rotatePoint({
        x: (finiteNumber(source.x) - finiteNumber(anchor.x)) * finiteNumber(scale.x, 1),
        y: (finiteNumber(source.y) - finiteNumber(anchor.y)) * finiteNumber(scale.y, 1),
        z: (finiteNumber(source.z) - finiteNumber(anchor.z)) * finiteNumber(scale.z, 1)
    }, transform.rotation);
    const position = transform.position || {};
    return {
        x: rotated.x + finiteNumber(position.x),
        y: rotated.y + finiteNumber(position.y),
        z: rotated.z + finiteNumber(position.z)
    };
};

const applyTransformScope = (configuration, transform) => {
    const result = {...configuration};
    if (configuration.position) result.position = transformPoint(configuration.position, transform);
    if (configuration.position1) result.position1 = transformPoint(configuration.position1, transform);
    if (configuration.position2) result.position2 = transformPoint(configuration.position2, transform);
    if (configuration.rotation) {
        const rotation = transform.rotation || {};
        result.rotation = {
            x: finiteNumber(configuration.rotation.x) + finiteNumber(rotation.x),
            y: finiteNumber(configuration.rotation.y) + finiteNumber(rotation.y),
            z: finiteNumber(configuration.rotation.z) + finiteNumber(rotation.z)
        };
    }
    if (configuration.scale) {
        const scale = transform.scale || {};
        result.scale = {
            x: finiteNumber(configuration.scale.x, 1) * finiteNumber(scale.x, 1),
            y: finiteNumber(configuration.scale.y, 1) * finiteNumber(scale.y, 1),
            z: finiteNumber(configuration.scale.z, 1) * finiteNumber(scale.z, 1)
        };
    }
    return result;
};

const applyObjectTransforms = (configuration, stack) => {
    if (!Array.isArray(stack) || !stack.length) return configuration;
    let result = configuration;
    // The innermost component owns local coordinates; outer transforms are applied afterwards.
    for (let index = stack.length - 1; index >= 0; index--) {
        result = applyTransformScope(result, stack[index]);
    }
    return result;
};

const executeSequence = (items, execute) => {
    if (!items) return;
    let index = 0;
    const advance = () => {
        while (index < items.length) {
            const result = execute(items[index++]);
            if (isPromise(result)) return Promise.resolve(result).then(advance);
        }
    };
    return advance();
};

const createNode = (type, properties, id) => ({
    ...properties,
    children: Array.isArray(properties.children) ? properties.children : [],
    id,
    type
});

const optimizeNode = node => {
    const children = [];
    for (const child of node.children || []) {
        const optimized = optimizeNode(child);
        if (optimized && optimized.type === FRAME_GRAPH_NODE_TYPES.GROUP && optimized.flattened &&
            !optimized.name && !optimized.simulation) {
            children.push(...optimized.children);
        } else if (optimized) {
            children.push(optimized);
        }
    }
    const optimized = {...node, children};

    if (node.type === FRAME_GRAPH_NODE_TYPES.DRAW) return optimized;
    // Scene nodes are executable state/scene operations. Camera and mutation scenes often have no children,
    // so pruning an empty Scene would silently remove an authored operation from the frame order.
    if (node.type === FRAME_GRAPH_NODE_TYPES.SCENE) return optimized;
    if (node.type === FRAME_GRAPH_NODE_TYPES.COMPOSITE && node.operation === 'effect') return optimized;
    if (node.type === FRAME_GRAPH_NODE_TYPES.COMPOSITE &&
        ['clear-pass', 'render-pass'].includes(node.operation)) return optimized;
    if (!children.length) return null;

    // Structural groups do not need their own render target. Flattening them reduces traversal and allocations
    // while preserving the authored node order. Named groups remain available for diagnostics.
    if (node.type === FRAME_GRAPH_NODE_TYPES.GROUP && !node.name && !node.simulation) {
        return children.length === 1 ? children[0] : {...optimized, children, flattened: true};
    }
    return optimized;
};

class MovieFrameGraphRenderer {
    constructor (renderer, executor) {
        this.renderer = renderer;
        this.executor = executor;
        this.currentFrame = null;
        this.generation = 0;
        this.pendingRender = null;
        this.nextFrameId = 1;
        this.nextNodeId = 1;
        this.lastGraph = null;
    }

    get collecting () {
        return Boolean(this.currentFrame);
    }

    beginFrame (metadata = {}) {
        if (this.currentFrame) return this.currentFrame;
        this.currentFrame = createNode(FRAME_GRAPH_NODE_TYPES.SCENE, {
            ...metadata,
            frameId: this.nextFrameId++,
            generation: this.generation,
            sceneKind: 'frame'
        }, this.nextNodeId++);
        return this.currentFrame;
    }

    append (type, properties = {}, parent = null) {
        if (!this.currentFrame || !VALID_NODE_TYPES.has(type)) return null;
        const owner = parent && Array.isArray(parent.children) ? parent : this.currentFrame;
        const node = createNode(type, properties, this.nextNodeId++);
        owner.children.push(node);
        return node;
    }

    discardFrame () {
        this.currentFrame = null;
        this.generation++;
    }

    flush () {
        const frame = this.currentFrame;
        this.currentFrame = null;
        if (!frame) return;
        const graph = optimizeNode(frame);
        if (!graph || !graph.children.length) return;
        this.lastGraph = graph;

        const execute = () => {
            if (graph.generation !== this.generation) return;
            return this.executor(graph);
        };
        const result = this.pendingRender ? this.pendingRender.then(execute, execute) : execute();
        if (!isPromise(result)) return;

        const tracked = Promise.resolve(result);
        this.pendingRender = tracked;
        const clear = () => {
            if (this.pendingRender === tracked) this.pendingRender = null;
        };
        tracked.then(clear, clear);
        return tracked;
    }
}

const installMovieFrameGraphRenderer = (renderer, executor) => {
    if (!renderer) return null;
    if (renderer.movieFrameGraph instanceof MovieFrameGraphRenderer) {
        renderer.movieFrameGraph.executor = executor;
        return renderer.movieFrameGraph;
    }
    const frameGraph = new MovieFrameGraphRenderer(renderer, executor);
    renderer.movieFrameGraph = frameGraph;
    return frameGraph;
};

export {
    FRAME_GRAPH_NODE_TYPES,
    MovieFrameGraphRenderer,
    applyObjectTransforms,
    applyTransformScope,
    executeSequence,
    rotatePoint,
    transformPoint,
    installMovieFrameGraphRenderer as default
};
