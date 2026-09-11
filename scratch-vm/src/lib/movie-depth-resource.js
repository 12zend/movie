const cloneCameraState = camera => {
    if (!camera) return null;
    return {
        ...camera,
        position: {...(camera.position || {})},
        rotation: {...(camera.rotation || {})}
    };
};

const createDepthOwner = (node, frameId = null) => {
    if (!node) return null;
    return Object.freeze({
        drawKind: node.drawKind || null,
        frameId,
        id: typeof node.id === 'undefined' ? null : node.id,
        operation: node.operation || null,
        sceneKind: node.sceneKind || null,
        type: node.type || 'target'
    });
};

const createDepthResource = (depthBuffer, options = {}) => {
    if (!depthBuffer) return null;
    const camera = typeof options.camera === 'undefined' ? depthBuffer.camera : options.camera;
    const requestedOwner = typeof options.ownerPass === 'undefined' ? depthBuffer.ownerPass : options.ownerPass;
    const ownerPass = requestedOwner ? Object.freeze({...requestedOwner}) : null;
    const targetId = typeof options.targetId === 'undefined' ? depthBuffer.targetId : options.targetId;
    const generation = typeof options.generation === 'undefined' ? depthBuffer.generation : options.generation;
    return Object.freeze({
        ...depthBuffer,
        camera: cloneCameraState(camera),
        generation,
        ownerPass,
        targetId: typeof targetId === 'undefined' ? null : targetId,
        texture: depthBuffer.texture || depthBuffer.canvas || null
    });
};

const getContextDepthResource = context => {
    if (!context) return null;
    if (context.resources) return context.resources.depth || null;
    return context.depthResource || null;
};

export {
    createDepthOwner,
    createDepthResource,
    getContextDepthResource
};
