import installMovieFrameGraphRenderer, {
    FRAME_GRAPH_NODE_TYPES,
    executeSequence,
    rotatePoint
} from '../../../src/lib/movie-frame-graph';

const deferred = () => {
    let resolve;
    const promise = new Promise(resolvePromise => {
        resolve = resolvePromise;
    });
    return {promise, resolve};
};

const nodeTypes = node => [node.type].concat(...node.children.map(nodeTypes));

describe('Movie frame graph renderer', () => {
    test('collects Draw, Group, Transform, Composite, and Scene before one renderer flush', () => {
        const renderer = {};
        const execute = jest.fn();
        const frameGraph = installMovieFrameGraphRenderer(renderer, execute);
        const root = frameGraph.beginFrame({timelineFrame: 12});
        const group = frameGraph.append(FRAME_GRAPH_NODE_TYPES.GROUP, {name: 'foreground'});
        const transform = frameGraph.append(FRAME_GRAPH_NODE_TYPES.TRANSFORM, {
            transform: {position: {x: 10, y: 20, z: 30}}
        }, group);
        const composite = frameGraph.append(FRAME_GRAPH_NODE_TYPES.COMPOSITE, {
            operation: 'blend',
            opacity: 0.5
        }, transform);
        frameGraph.append(FRAME_GRAPH_NODE_TYPES.DRAW, {drawKind: 'object'}, composite);
        const scene = frameGraph.append(FRAME_GRAPH_NODE_TYPES.SCENE, {
            sceneKind: 'objects'
        }, root);
        frameGraph.append(FRAME_GRAPH_NODE_TYPES.DRAW, {drawKind: 'object'}, scene);

        expect(execute).not.toHaveBeenCalled();
        expect(frameGraph.flush()).toBeUndefined();
        expect(execute).toHaveBeenCalledTimes(1);
        expect(nodeTypes(execute.mock.calls[0][0])).toEqual(expect.arrayContaining([
            FRAME_GRAPH_NODE_TYPES.DRAW,
            FRAME_GRAPH_NODE_TYPES.GROUP,
            FRAME_GRAPH_NODE_TYPES.TRANSFORM,
            FRAME_GRAPH_NODE_TYPES.COMPOSITE,
            FRAME_GRAPH_NODE_TYPES.SCENE
        ]));
        expect(renderer.movieFrameGraph).toBe(frameGraph);
        expect(frameGraph.lastGraph.timelineFrame).toBe(12);
    });

    test('does not interleave a later frame with asynchronous rendering from the previous frame', async () => {
        const firstFrame = deferred();
        const renderedFrames = [];
        const frameGraph = installMovieFrameGraphRenderer({}, graph => {
            renderedFrames.push(graph.frameId);
            if (graph.frameId === 1) return firstFrame.promise;
        });

        frameGraph.beginFrame();
        frameGraph.append(FRAME_GRAPH_NODE_TYPES.DRAW, {drawKind: 'first'});
        const firstRender = frameGraph.flush();
        frameGraph.beginFrame();
        frameGraph.append(FRAME_GRAPH_NODE_TYPES.DRAW, {drawKind: 'second'});
        const secondRender = frameGraph.flush();

        expect(renderedFrames).toEqual([1]);
        firstFrame.resolve();
        await firstRender;
        await secondRender;
        expect(renderedFrames).toEqual([1, 2]);
    });

    test('drops a queued graph after the current generation is discarded', async () => {
        const firstFrame = deferred();
        const renderedFrames = [];
        const frameGraph = installMovieFrameGraphRenderer({}, graph => {
            renderedFrames.push(graph.frameId);
            if (graph.frameId === 1) return firstFrame.promise;
        });
        frameGraph.beginFrame();
        frameGraph.append(FRAME_GRAPH_NODE_TYPES.DRAW, {drawKind: 'first'});
        frameGraph.flush();
        frameGraph.beginFrame();
        frameGraph.append(FRAME_GRAPH_NODE_TYPES.DRAW, {drawKind: 'stale'});
        const staleRender = frameGraph.flush();

        frameGraph.discardFrame();
        firstFrame.resolve();
        await staleRender;

        expect(renderedFrames).toEqual([1]);
    });

    test('executes synchronous nodes immediately and preserves order after the first asynchronous node', async () => {
        const wait = deferred();
        const events = [];
        const result = executeSequence(['draw', 'scene', 'stamp'], item => {
            events.push(item);
            if (item === 'draw') return wait.promise;
        });

        expect(events).toEqual(['draw']);
        wait.resolve();
        await result;
        expect(events).toEqual(['draw', 'scene', 'stamp']);
    });
});


test('runs 1000 synchronous siblings in the same continuation after an asynchronous resource', async () => {
    const events = [];
    const result = executeSequence(Array.from({length: 1001}, (_, index) => index), index => {
        if (index === 0) return Promise.resolve();
        events.push(index);
        if (index === 1) Promise.resolve().then(() => events.push('microtask'));
    });
    await result;
    expect(events.slice(0, 1000)).toEqual(Array.from({length: 1000}, (_, index) => index + 1));
    expect(events[1000]).toBe('microtask');
});


test('reuses group rotation trigonometry across 1000 points and invalidates it on edits', () => {
    const rotation = {x: 0, y: 0, z: 90};
    const sine = jest.spyOn(Math, 'sin');
    try {
        for (let index = 0; index < 1000; index++) {
            const point = rotatePoint({x: 1, y: 0, z: 0}, rotation);
            expect(point.x).toBeCloseTo(0);
            expect(point.y).toBeCloseTo(1);
        }
        expect(sine).toHaveBeenCalledTimes(3);
        rotation.z = 180;
        expect(rotatePoint({x: 1, y: 0, z: 0}, rotation).x).toBeCloseTo(-1);
        expect(sine).toHaveBeenCalledTimes(6);
    } finally {
        sine.mockRestore();
    }
});
