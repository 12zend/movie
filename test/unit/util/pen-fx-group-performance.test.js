import createPenFXEngine from '../../../src/lib/pen-fx/engine';

const makeEngine = () => {
    const gl = {
        BLEND: 1, FUNC_ADD: 2, ONE: 3, ONE_MINUS_SRC_ALPHA: 4,
        deleteTexture: jest.fn(), deleteFramebuffer: jest.fn(),
        enable: jest.fn(), blendEquation: jest.fn(), blendFunc: jest.fn()
    };
    const engine = Object.create(createPenFXEngine(gl, {}).prototype);
    Object.assign(engine, {
        width: 480, height: 360, groupStack: [], renderPasses: new Map(),
        framebuffers: ['work-fb'], textures: ['work-texture']
    });
    const skin = {_texture: 'baseline', _framebuffer: {framebuffer: 'baseline-fb'}};
    engine._prepare = jest.fn(() => skin);
    let serial = 0;
    engine._createBufferTexture = jest.fn(() => ({texture: `texture-${++serial}`, framebuffer: `fb-${serial}`}));
    engine._clearTransparent = jest.fn();
    engine._restoreGLState = jest.fn();
    engine._markSkinChanged = jest.fn();
    engine._program = jest.fn(name => name);
    engine._render = jest.fn();
    engine._replaceSkin = jest.fn();
    return {engine, gl, skin};
};

describe('Objects grouping GPU resource scaling', () => {
    test('reuses one isolated target and one composite pass for 1000 synchronous groups', () => {
        const {engine, gl, skin} = makeEngine();
        for (let index = 0; index < 1000; index++) {
            expect(engine.beginGroup()).toBeUndefined();
            expect(skin.getTexture()).toBe('baseline');
            expect(skin._texture).toBe('texture-1');
            expect(engine.endGroup()).toBeUndefined();
            expect(skin._texture).toBe('baseline');
        }
        expect(engine._createBufferTexture).toHaveBeenCalledTimes(1);
        expect(engine._clearTransparent).toHaveBeenCalledTimes(1000);
        expect(engine._render).toHaveBeenCalledTimes(1000);
        expect(engine._render).toHaveBeenLastCalledWith('copy', 'baseline-fb',
            [{name: 'u_image', texture: 'texture-1'}], {}, []);
        expect(engine._replaceSkin).not.toHaveBeenCalled();
        expect(gl.blendFunc).toHaveBeenCalledWith(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        expect(gl.deleteTexture).not.toHaveBeenCalled();
        engine.clearGroupStack();
        expect(gl.deleteTexture).toHaveBeenCalledWith('texture-1');
        expect(engine.groupBufferPool).toHaveLength(0);
    });

    test('isolates nested groups and restores the completed frame on cancellation', () => {
        const {engine, gl, skin} = makeEngine();
        engine.beginGroup();
        engine.beginGroup();
        expect(engine._createBufferTexture).toHaveBeenCalledTimes(2);
        expect(skin._texture).toBe('texture-2');
        expect(skin.getTexture()).toBe('baseline');
        engine.clearGroupStack();
        expect(skin._texture).toBe('baseline');
        expect(Object.prototype.hasOwnProperty.call(skin, 'getTexture')).toBe(false);
        expect(gl.deleteTexture.mock.calls).toEqual([['texture-2'], ['texture-1']]);
    });

    test('bounds idle storage and never reuses a buffer after a size change', () => {
        const {engine, gl} = makeEngine();
        const buffers = Array.from({length: 20}, () => engine._acquireGroupBuffer());
        buffers.forEach(buffer => engine._releaseGroupBuffer(buffer));
        expect(engine.groupBufferPool).toHaveLength(8);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(12);
        engine._clearGroupBufferPool();
        const outstanding = engine._acquireGroupBuffer();
        engine.width = 960;
        engine._releaseGroupBuffer(outstanding);
        expect(engine.groupBufferPool).toHaveLength(0);
        expect(gl.deleteTexture).toHaveBeenLastCalledWith(outstanding.texture);
    });

    test('keeps blend, opacity, expanded effects and named passes on their isolated paths', () => {
        const {engine} = makeEngine();
        engine.beginGroup();
        engine.endGroup({opacity: 0.5});
        expect(engine._render).toHaveBeenLastCalledWith('groupOver', 'work-fb', expect.any(Array),
            {u_blend: 0, u_opacity: 0.5}, ['u_blend']);
        engine.beginGroup();
        engine.groupStack[0].expandedOutput = true;
        engine.endGroup();
        expect(engine._render).toHaveBeenLastCalledWith('composite', 'work-fb', expect.any(Array),
            {u_blend: 0, u_opacity: 1}, ['u_blend']);
        engine.beginGroup();
        engine.endGroup({composite: false, passName: 'saved'});
        expect(engine.groupBufferPool).toHaveLength(0);
        expect(engine.renderPasses.get('saved').texture).toBe('texture-1');
    });
});
