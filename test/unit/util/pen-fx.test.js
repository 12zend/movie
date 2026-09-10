import VM from 'scratch-vm';

import installPenFX, {createPenFXClass} from '../../../src/lib/pen-fx';

describe('built-in Pen FX category', () => {
    test('clamps wavy samples to the image bounds instead of making them transparent', () => {
        const gl = {
            VERTEX_SHADER: 1,
            ARRAY_BUFFER: 2,
            STATIC_DRAW: 3,
            createShader: jest.fn(() => ({})),
            shaderSource: jest.fn(),
            compileShader: jest.fn(),
            getShaderParameter: jest.fn(() => true),
            deleteShader: jest.fn(),
            createBuffer: jest.fn(() => ({})),
            bindBuffer: jest.fn(),
            bufferData: jest.fn()
        };
        const vm = {runtime: {renderer: {_gl: gl}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();

        const wavyShader = penFX._getEngine().programSources.wavy;

        expect(wavyShader).toContain('texture2D(u_image, clamp(uv, vec2(0.0), vec2(1.0)))');
        expect(wavyShader).not.toContain('return vec4(0.0)');
    });

    test('exposes the Pen FX blocks through an internal category', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const info = new PenFX().getInfo();

        expect(info.id).toBe('penfx');
        expect(info.name).toBe('エフェクト');
        expect(info.blockIconURI).toBeUndefined();
        expect(info.blocks.find(block => block.opcode === 'contrast')).toBeDefined();
        const vhs = info.blocks.find(block => block.opcode === 'vhs');
        const glitch = info.blocks.find(block => block.opcode === 'glitch');
        expect(vhs).toBeDefined();
        expect(glitch).toBeDefined();
        expect(vhs.arguments.SEED.defaultValue).toBe(0);
        expect(glitch.arguments.SEED.defaultValue).toBe(0);
        expect(vhs.arguments.EVOLUTION.defaultValue).toBe(0);
        expect(glitch.arguments.EVOLUTION.defaultValue).toBe(0);
        expect(info.menus.stretchType.items).toEqual(['x', 'y', 'size', 'dir']);
        expect(info.menus.sortAxis.items).toEqual(['x', 'y', 'size', 'dir']);
        expect(info.menus.turbulenceType.items).toEqual(['both', 'x', 'y', 'size', 'dir']);
        const edgeDetection = info.blocks.find(block => block.opcode === 'edgeDetection');
        expect(edgeDetection.arguments.BACKGROUND.defaultValue).toBe('#ffffff');
        expect(info.blocks.find(block => block.opcode === 'duplicate')).toBeDefined();
        expect(info.blocks.find(block => block.opcode === 'bufferStackSize')).toBeDefined();
        expect(info.blocks.find(block => block.opcode === 'colorOverlay')).toBeDefined();
        expect(info.blocks.find(block => block.opcode === 'gradationOverlay')).toBeDefined();
        const stroke = info.blocks.find(block => block.opcode === 'stroke');
        expect(stroke).toBeDefined();
        expect(stroke.arguments.COLOR.defaultValue).toBe('#000000');
        expect(stroke.arguments.WIDTH.defaultValue).toBe(4);
        const blob = info.blocks.find(block => block.opcode === 'blob');
        expect(blob).toBeDefined();
        expect(blob.arguments.COLOR.defaultValue).toBe('#00ffff');
        expect(blob.arguments.THRESHOLD.defaultValue).toBe(50);
        expect(info.menus.blobMode.items).toEqual(['bright', 'dark', 'color', 'motion', 'alpha']);
        expect(info.menus.blobShape.items).toEqual(['rectangle', 'ellipse']);
        const depthOfField = info.blocks.find(block => block.opcode === 'depthOfField');
        expect(depthOfField).toBeDefined();
        expect(depthOfField.arguments.FOCUS.defaultValue).toBe(480);
        const fog = info.blocks.find(block => block.opcode === 'fog');
        expect(fog).toBeDefined();
        expect(fog.arguments.START.defaultValue).toBe(100);
        expect(fog.arguments.END.defaultValue).toBe(1000);
        expect(fog.arguments.NEARCOLOR.defaultValue).toBe('#d9e7f2');
        expect(fog.arguments.FARCOLOR.defaultValue).toBe('#ffffff');
        expect(info.menus.fogType.items).toEqual(['linear', 'smooth', 'exponential', 'exponential squared']);
        const fractalNoise = info.blocks.find(block => block.opcode === 'fractalnoise');
        expect(fractalNoise).toBeDefined();
        expect(fractalNoise.arguments.DEPTH.defaultValue).toBe(6);
        expect(info.menus.fractalType.items).toEqual([
            '基本', 'タービュレント(滑らか)', 'タービュレント(基本)', 'タービュレント(シャープ)',
            'ダイナミック', 'ダイナミック（プログレッシブ）', 'ダイナミック（ツイスト）', '最大',
            'にじみ', '渦巻き', '岩肌', '曇り雲', '土', 'サブスケール', '小さなバンプ',
            'ストリング', 'スレッド'
        ]);
        expect(info.menus.fractalNoiseType.items).toEqual(['ブロック', 'リニア', 'ソフトリニア', 'スプライン']);
        expect(info.menus.fractalOverflowType.items).toEqual(['HDR', 'Clip', 'Soft clamp']);
    });

    test('routes RGB overlay and multi-stop gradation overlay without returning a promise', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {
            colorOverlay: jest.fn(),
            gradationOverlay: jest.fn()
        };

        expect(penFX.colorOverlay({COLOR: '#204080', MIX: 75})).toBeUndefined();
        expect(penFX.gradationOverlay({
            DIR: 30,
            GRADIENT: JSON.stringify({
                stops: [
                    {color: '#ff0000', position: 0},
                    {color: '#00ff00', position: 0.4},
                    {color: '#0000ff', position: 1}
                ]
            }),
            MIX: 60
        })).toBeUndefined();

        expect(penFX.engine.colorOverlay).toHaveBeenCalledWith([32 / 255, 64 / 255, 128 / 255], 0.75, 'normal');
        expect(penFX.engine.gradationOverlay).toHaveBeenCalledWith([
            {color: [1, 0, 0], position: 0},
            {color: [0, 1, 0], position: 0.4},
            {color: [0, 0, 1], position: 1}
        ], 30, 0.6, 'normal');
    });

    test('routes stroke color and width without returning a promise', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {stroke: jest.fn()};

        const result = penFX.stroke({COLOR: '#204080', WIDTH: 12});

        expect(result).toBeUndefined();
        expect(penFX.engine.stroke).toHaveBeenCalledWith([32 / 255, 64 / 255, 128 / 255], 12, 'normal');
    });

    test('routes synchronous blob detection and bounding-box overlay controls', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {blob: jest.fn()};

        const result = penFX.blob({
            BLUR: 3,
            COLOR: '#00ffff',
            FILL: 20,
            KEY: '#ff0000',
            MARKER: 'true',
            MAX: 80,
            MIN: 2,
            MODE: 'color',
            OPACITY: 75,
            SHAPE: 'ellipse',
            THRESHOLD: 40,
            WIDTH: 4
        });

        expect(result).toBeUndefined();
        expect(penFX.engine.blob).toHaveBeenCalledWith({
            blurRadius: 3,
            color: [0, 1, 1],
            fillOpacity: 0.2,
            marker: true,
            maximumSize: 80,
            minimumSize: 2,
            mode: 'color',
            shape: 'ellipse',
            strokeOpacity: 0.75,
            strokeWidth: 4,
            targetColor: [1, 0, 0],
            threshold: 40
        }, 'normal');
    });

    test('reads the current drawing and uploads multiple blob boxes in the same tick', () => {
        const gl = {
            ARRAY_BUFFER: 1,
            FRAMEBUFFER: 2,
            RGBA: 3,
            STATIC_DRAW: 4,
            TEXTURE_2D: 5,
            UNSIGNED_BYTE: 6,
            VERTEX_SHADER: 7,
            bindBuffer: jest.fn(),
            bindFramebuffer: jest.fn(),
            bindTexture: jest.fn(),
            bufferData: jest.fn(),
            compileShader: jest.fn(),
            createBuffer: jest.fn(() => ({})),
            createShader: jest.fn(() => ({})),
            deleteShader: jest.fn(),
            getShaderParameter: jest.fn(() => true),
            readPixels: jest.fn((x, y, width, height, format, type, output) => {
                for (let offset = 0; offset < output.length; offset += 4) {
                    output.set([0, 0, 0, 255], offset);
                }
                output.set([255, 255, 255, 255], 0);
                output.set([255, 255, 255, 255], 6 * 4);
            }),
            shaderSource: jest.fn(),
            texSubImage2D: jest.fn()
        };
        const skin = {_texture: 'pen-texture'};
        const renderer = {_gl: gl};
        const PenFX = createPenFXClass({runtime: {renderer}});
        const engine = new PenFX()._getEngine();
        engine.blendOpacity = 1;
        engine.framebuffers = ['source-framebuffer'];
        engine.height = 2;
        engine.textures = ['source-texture'];
        engine.width = 4;
        engine._canRenderDirectly = jest.fn(() => true);
        engine._markSkinChanged = jest.fn();
        engine._prepare = jest.fn(() => skin);

        const result = engine.blob({
            blurRadius: 0,
            color: [0, 1, 1],
            fillOpacity: 0,
            marker: false,
            maximumSize: 100,
            minimumSize: 0,
            mode: 'bright',
            shape: 'rectangle',
            strokeOpacity: 1,
            strokeWidth: 1,
            targetColor: [1, 1, 1],
            threshold: 200
        }, 'normal');

        expect(result).toBeUndefined();
        expect(gl.readPixels).toHaveBeenCalledWith(0, 0, 4, 2, gl.RGBA, gl.UNSIGNED_BYTE,
            expect.any(Uint8Array));
        expect(gl.texSubImage2D).toHaveBeenCalledTimes(1);
        const uploaded = gl.texSubImage2D.mock.calls[0][8];
        expect(Array.from(uploaded.slice(0, 4))).toEqual([0, 255, 255, 255]);
        expect(Array.from(uploaded.slice(24, 28))).toEqual([0, 255, 255, 255]);
        expect(engine._markSkinChanged).toHaveBeenCalledWith(skin);
    });

    test('provides a bounded GPU stroke shader which preserves the original over the outline', () => {
        const gl = {
            VERTEX_SHADER: 1,
            ARRAY_BUFFER: 2,
            STATIC_DRAW: 3,
            createShader: jest.fn(() => ({})),
            shaderSource: jest.fn(),
            compileShader: jest.fn(),
            getShaderParameter: jest.fn(() => true),
            deleteShader: jest.fn(),
            createBuffer: jest.fn(() => ({})),
            bindBuffer: jest.fn(),
            bufferData: jest.fn()
        };
        const vm = {runtime: {renderer: {_gl: gl}}};
        const PenFX = createPenFXClass(vm);
        const shader = new PenFX()._getEngine().programSources.stroke;

        expect(shader).toContain('for (int y = -8; y <= 8; y++)');
        expect(shader).toContain('float strokeAlpha = expandedAlpha * (1.0 - base.a)');
        expect(shader).toContain('base.rgb + u_color * strokeAlpha');
    });

    test('routes fractal noise controls without returning a promise', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {fractalNoise: jest.fn()};

        const result = penFX.fractalnoise({
            FRACTALTYPE: 'ダイナミック（ツイスト）',
            NOISETYPE: 'スプライン',
            INVERT: 'true',
            CONTRAST: 135,
            BRIGHTNESS: -12,
            OVERFLOW: 'Soft clamp',
            ROTATE: 30,
            SCALE: 80,
            WIDTH: 120,
            HEIGHT: 65,
            OX: 14,
            OY: -9,
            PERSPECTIVE: 'true',
            DEPTH: 7,
            EVOLUTION: 540,
            CYCLEEVOLUTION: 'true',
            FREQ: 3
        });

        expect(result).toBeUndefined();
        expect(penFX.engine.fractalNoise).toHaveBeenCalledWith(
            'ダイナミック（ツイスト）', 'スプライン', true, 135, -12, 'Soft clamp', 30,
            80, 120, 65, 14, -9, true, 7, 540, true, 3, 'normal'
        );
    });

    test('provides a GPU fractal noise shader with interpolation and cycle controls', () => {
        const gl = {
            VERTEX_SHADER: 1,
            ARRAY_BUFFER: 2,
            STATIC_DRAW: 3,
            createShader: jest.fn(() => ({})),
            shaderSource: jest.fn(),
            compileShader: jest.fn(),
            getShaderParameter: jest.fn(() => true),
            deleteShader: jest.fn(),
            createBuffer: jest.fn(() => ({})),
            bindBuffer: jest.fn(),
            bufferData: jest.fn()
        };
        const vm = {runtime: {renderer: {_gl: gl}}};
        const PenFX = createPenFXClass(vm);
        const shader = new PenFX()._getEngine().programSources.fractalNoise;

        expect(shader).toContain('uniform int u_fractalType');
        expect(shader).toContain('uniform int u_noiseType');
        expect(shader).toContain('for (int i = 0; i < 10; i++)');
        expect(shader).toContain('if (u_cycleEvolution == 1)');
        expect(shader).toContain('if (original.a <= 0.00001)');
    });

    test('routes depth of field controls and the target depth resource without returning a promise', () => {
        const depthResource = {canvas: {}, near: 1, far: 1000, version: 3};
        const target = {id: 'sprite'};
        const movieAssetManager = {getDepthResource: jest.fn(() => depthResource)};
        const vm = {runtime: {movieAssetManager, renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {depthOfField: jest.fn()};

        const result = penFX.depthOfField({
            FOCUS: 520,
            RANGE: 30,
            APERTURE: 64,
            MAXBLUR: 28,
            NEAR: 80,
            FAR: 125,
            EDGE: 6,
            SHAPE: 'hexagon',
            ROTATION: 15,
            MIX: 75
        }, {target});

        expect(result).toBeUndefined();
        expect(movieAssetManager.getDepthResource).toHaveBeenCalledWith(target.id);
        expect(penFX.engine.depthOfField).toHaveBeenCalledWith(
            depthResource, 520, 30, 64, 28, 0.8, 1.25, 6, 'hexagon', 15, 0.75, 'normal'
        );
    });

    test('uses a depth-aware bokeh shader which rejects samples across foreground edges', () => {
        const gl = {
            VERTEX_SHADER: 1,
            ARRAY_BUFFER: 2,
            STATIC_DRAW: 3,
            createShader: jest.fn(() => ({})),
            shaderSource: jest.fn(),
            compileShader: jest.fn(),
            getShaderParameter: jest.fn(() => true),
            deleteShader: jest.fn(),
            createBuffer: jest.fn(() => ({})),
            bindBuffer: jest.fn(),
            bufferData: jest.fn()
        };
        const vm = {runtime: {renderer: {_gl: gl}}};
        const PenFX = createPenFXClass(vm);
        const shader = new PenFX()._getEngine().programSources.depthOfField;

        expect(shader).toContain('uniform sampler2D u_depth');
        expect(shader).toContain('if (u_flatDepth > 0.0) return u_flatDepth');
        expect(shader).not.toMatch(/\bpacked\b/);
        expect(shader).toContain('float behindForeground');
        expect(shader).toContain('for (int i = 0; i < 20; i++)');
    });

    test('routes flexible depth fog controls and the target depth resource without returning a promise', () => {
        const depthResource = {canvas: {}, near: 1, far: 2000, version: 4};
        const target = {id: 'sprite'};
        const movieAssetManager = {getDepthResource: jest.fn(() => depthResource)};
        const vm = {runtime: {movieAssetManager, renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {fog: jest.fn()};

        const result = penFX.fog({
            TYPE: 'exponential squared',
            START: 75,
            END: 1600,
            NEARCOLOR: '#204080',
            FARCOLOR: '#ffe0c0',
            DENSITY: 65,
            CURVE: 1.75,
            MIX: 80
        }, {target});

        expect(result).toBeUndefined();
        expect(movieAssetManager.getDepthResource).toHaveBeenCalledWith(target.id);
        expect(penFX.engine.fog).toHaveBeenCalledWith(
            depthResource, 'exponential squared', 75, 1600, 0.65, 1.75,
            [32 / 255, 64 / 255, 128 / 255], [1, 224 / 255, 192 / 255], 0.8, 'normal'
        );
    });

    test('uses an explicit render-pass depth resource instead of stale target depth for captured effects', () => {
        const staleDepth = {canvas: {name: 'stale target depth'}};
        const passDepth = {canvas: {name: 'current pass depth'}};
        const movieAssetManager = {getDepthResource: jest.fn(() => staleDepth)};
        const vm = {runtime: {movieAssetManager, renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {depthOfField: jest.fn()};
        penFX.beginEffectCapture();

        expect(penFX.depthOfField({MIX: 100}, {target: {id: 'sprite'}})).toBeUndefined();
        const effects = penFX.endEffectCapture();
        penFX.applyCapturedEffects(effects, {resources: {depth: passDepth}});

        expect(penFX.engine.depthOfField).toHaveBeenCalledWith(
            passDepth,
            480,
            24,
            48,
            24,
            1,
            1,
            8,
            'circle',
            0,
            1,
            'normal'
        );
        expect(movieAssetManager.getDepthResource).not.toHaveBeenCalled();
    });

    test('uses depth-aware fog which preserves transparent pixels and supports reversed ranges', () => {
        const gl = {
            VERTEX_SHADER: 1,
            ARRAY_BUFFER: 2,
            STATIC_DRAW: 3,
            createShader: jest.fn(() => ({})),
            shaderSource: jest.fn(),
            compileShader: jest.fn(),
            getShaderParameter: jest.fn(() => true),
            deleteShader: jest.fn(),
            createBuffer: jest.fn(() => ({})),
            bindBuffer: jest.fn(),
            bufferData: jest.fn()
        };
        const vm = {runtime: {renderer: {_gl: gl}}};
        const PenFX = createPenFXClass(vm);
        const shader = new PenFX()._getEngine().programSources.fog;

        expect(shader).toContain('uniform sampler2D u_depth');
        expect(shader).toContain('if (u_flatDepth > 0.0) return u_flatDepth');
        expect(shader).not.toMatch(/\bpacked\b/);
        expect(shader).toContain('(depth - u_start) / span');
        expect(shader).toContain('if (original.a <= 0.00001');
        expect(shader).toContain('u_nearColor');
        expect(shader).toContain('u_farColor');
        expect(shader).toContain('u_mode == 3');
    });

    test('renders fog and depth of field from a flat object depth without a model zBuffer texture', () => {
        const gl = {
            VERTEX_SHADER: 1,
            ARRAY_BUFFER: 2,
            STATIC_DRAW: 3,
            createShader: jest.fn(() => ({})),
            shaderSource: jest.fn(),
            compileShader: jest.fn(),
            getShaderParameter: jest.fn(() => true),
            deleteShader: jest.fn(),
            createBuffer: jest.fn(() => ({})),
            bindBuffer: jest.fn(),
            bufferData: jest.fn()
        };
        const vm = {runtime: {renderer: {_gl: gl}}};
        const PenFX = createPenFXClass(vm);
        const engine = new PenFX()._getEngine();
        const imageTexture = {};
        engine.textures = [imageTexture];
        engine.resolution = new Float32Array([480, 360]);
        engine._prepare = jest.fn(() => ({}));
        engine._program = jest.fn(name => name);
        engine._renderEffect = jest.fn();
        engine._uploadDepthBuffer = jest.fn();

        engine.fog({flatDepth: 1000}, 'linear', 0, 1000, 1, 1, [1, 1, 1], [1, 1, 1], 1, 'normal');
        engine.depthOfField({flatDepth: 1000}, 100, 24, 48, 32, 1, 1, 8, 'hexagon', 0, 1, 'normal');

        expect(engine._uploadDepthBuffer).not.toHaveBeenCalled();
        expect(engine._renderEffect).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            'fog',
            [
                {name: 'u_image', texture: imageTexture},
                {name: 'u_depth', texture: imageTexture}
            ],
            expect.objectContaining({u_flatDepth: 1000}),
            ['u_mode'],
            'normal'
        );
        expect(engine._renderEffect).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            'depthOfField',
            expect.any(Array),
            expect.objectContaining({u_flatDepth: 1000}),
            [],
            'normal'
        );
    });

    test('routes deterministic VHS and glitch controls to the GPU engine', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {
            vhs: jest.fn(),
            digitalGlitch: jest.fn()
        };

        penFX.vhs({TRACKING: 8, CHROMA: 4, NOISE: 20, SCANLINES: 30, SEED: 91, EVOLUTION: 12, MIX: 75});
        penFX.glitch({SLICES: 32, SHIFT: 40, RGB: 7, DENSITY: 45, SEED: 92, EVOLUTION: 13, MIX: 80});

        expect(penFX.engine.vhs).toHaveBeenCalledWith(8, 4, 0.2, 0.3, 91, 12, 0.75, 'normal');
        expect(penFX.engine.digitalGlitch).toHaveBeenCalledWith(32, 40, 7, 0.45, 92, 13, 0.8, 'normal');
    });

    test('restores the renderer state when an effect shader fails', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        const failure = new Error('shader compilation failed');
        penFX.engine = {
            blendOpacity: 0,
            color: jest.fn(() => {
                throw failure;
            }),
            _restoreGLState: jest.fn()
        };
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(penFX.contrast({VALUE: 2, PIVOT: 0.5, MIX: 100})).toBeUndefined();
        expect(penFX.engine._restoreGLState).toHaveBeenCalledTimes(1);
        expect(consoleError).toHaveBeenCalledWith('[Pen FX]', failure);
        consoleError.mockRestore();
    });

    test('exposes grouping boundaries to the Objects control block', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {
            beginGroup: jest.fn(),
            endGroup: jest.fn()
        };

        expect(penFX.beginGroup()).toBeUndefined();
        expect(penFX.endGroup()).toBeUndefined();
        expect(penFX.engine.beginGroup).toHaveBeenCalledTimes(1);
        expect(penFX.engine.endGroup).toHaveBeenCalledTimes(1);
        expect(vm.runtime.penFX).toBe(penFX);
    });

    test('exposes matte capture boundaries to the Objects control block', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {
            beginMatte: jest.fn(() => true),
            beginMatteMask: jest.fn(() => true),
            endMatte: jest.fn(() => true)
        };

        expect(penFX.beginMatte()).toBe(true);
        expect(penFX.beginMatteMask()).toBe(true);
        expect(penFX.endMatte({mode: 'luma'})).toBe(true);
        expect(penFX.engine.endMatte).toHaveBeenCalledWith({mode: 'luma'});
    });

    test('cancels open groups and captured effects together', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {
            _restoreGLState: jest.fn(),
            clearGroupStack: jest.fn(),
            clearMatteStack: jest.fn()
        };
        penFX.effectCaptureStack = [{}];

        expect(penFX.cancelGroups()).toBeUndefined();
        expect(penFX.effectCaptureStack).toEqual([]);
        expect(penFX.engine.clearGroupStack).toHaveBeenCalledTimes(1);
        expect(penFX.engine.clearMatteStack).toHaveBeenCalledTimes(1);
        expect(penFX.engine._restoreGLState).toHaveBeenCalledTimes(1);
    });

    test('stages an Objects group on a transparent layer without touching the visible pen frame', () => {
        const gl = {
            ARRAY_BUFFER: 1,
            BLEND: 2,
            COLOR_BUFFER_BIT: 4,
            DEPTH_TEST: 5,
            FRAMEBUFFER: 6,
            FUNC_ADD: 7,
            ONE: 8,
            ONE_MINUS_SRC_ALPHA: 9,
            SCISSOR_TEST: 10,
            STATIC_DRAW: 11,
            STENCIL_TEST: 12,
            TEXTURE0: 13,
            VERTEX_SHADER: 14,
            activeTexture: jest.fn(),
            bindBuffer: jest.fn(),
            bindFramebuffer: jest.fn(),
            blendEquation: jest.fn(),
            blendFunc: jest.fn(),
            bufferData: jest.fn(),
            clear: jest.fn(),
            clearColor: jest.fn(),
            colorMask: jest.fn(),
            compileShader: jest.fn(),
            createBuffer: jest.fn(() => ({})),
            createShader: jest.fn(() => ({})),
            deleteFramebuffer: jest.fn(),
            deleteTexture: jest.fn(),
            disable: jest.fn(),
            enable: jest.fn(),
            getShaderParameter: jest.fn(() => true),
            shaderSource: jest.fn()
        };
        const penFramebuffer = {framebuffer: 'pen-framebuffer'};
        const skin = {
            _framebuffer: penFramebuffer,
            _size: [480, 360],
            _texture: 'pen-texture'
        };
        const renderer = {
            _allSkins: {1: skin},
            _doExitDrawRegion: jest.fn(),
            _gl: gl,
            _penSkinId: 1
        };
        const PenFX = createPenFXClass({runtime: {renderer}});
        const engine = new PenFX()._getEngine();
        engine.width = 480;
        engine.height = 360;
        engine._createBufferTexture = jest.fn(() => ({framebuffer: 'group-framebuffer', texture: 'group-staging'}));
        engine._program = jest.fn(() => 'copy-program');
        engine._render = jest.fn();

        engine.beginGroup();

        expect(gl.disable).toHaveBeenCalledWith(gl.STENCIL_TEST);
        expect(gl.colorMask).toHaveBeenCalledWith(true, true, true, true);
        expect(gl.clearColor).toHaveBeenCalledWith(0, 0, 0, 0);
        expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT);
        expect(gl.bindFramebuffer).toHaveBeenCalledWith(gl.FRAMEBUFFER, 'group-framebuffer');
        expect(skin._texture).toBe('group-staging');
        expect(skin._framebuffer).toEqual({
            attachments: ['group-staging'],
            framebuffer: 'group-framebuffer',
            height: 360,
            width: 480
        });
        expect(skin.getTexture()).toBe('pen-texture');
        expect(engine.groupStack).toEqual([{
            buffer: {framebuffer: 'group-framebuffer', texture: 'group-staging', width: 480, height: 360},
            baselineFramebuffer: penFramebuffer,
            baselineTexture: 'pen-texture',
            framebuffer: 'group-framebuffer',
            hadOwnGetTexture: false,
            originalGetTexture: undefined,
            skin,
            texture: 'group-staging'
        }]);
    });

    test('composites a finished Objects group over the untouched baseline', () => {
        const gl = {
            ARRAY_BUFFER: 1,
            BLEND: 2,
            COLOR_BUFFER_BIT: 4,
            DEPTH_TEST: 5,
            FRAMEBUFFER: 6,
            FUNC_ADD: 7,
            ONE: 8,
            ONE_MINUS_SRC_ALPHA: 9,
            SCISSOR_TEST: 10,
            STATIC_DRAW: 11,
            STENCIL_TEST: 12,
            TEXTURE0: 13,
            VERTEX_SHADER: 14,
            activeTexture: jest.fn(),
            bindBuffer: jest.fn(),
            bindFramebuffer: jest.fn(),
            blendEquation: jest.fn(),
            blendFunc: jest.fn(),
            bufferData: jest.fn(),
            clear: jest.fn(),
            clearColor: jest.fn(),
            colorMask: jest.fn(),
            compileShader: jest.fn(),
            createBuffer: jest.fn(() => ({})),
            createShader: jest.fn(() => ({})),
            deleteFramebuffer: jest.fn(),
            deleteTexture: jest.fn(),
            disable: jest.fn(),
            enable: jest.fn(),
            getShaderParameter: jest.fn(() => true),
            shaderSource: jest.fn()
        };
        const penFramebuffer = {framebuffer: 'pen-framebuffer'};
        const skin = {
            _framebuffer: penFramebuffer,
            _size: [480, 360],
            _texture: 'pen-texture'
        };
        const renderer = {
            _allSkins: {1: skin},
            _doExitDrawRegion: jest.fn(),
            _gl: gl,
            _penSkinId: 1
        };
        const PenFX = createPenFXClass({runtime: {renderer}});
        const engine = new PenFX()._getEngine();
        engine.width = 480;
        engine.height = 360;
        engine.framebuffers = ['engine-framebuffer'];
        engine.textures = ['engine-texture'];
        engine._createBufferTexture = jest.fn(() => ({framebuffer: 'group-framebuffer', texture: 'group-staging'}));
        engine._program = jest.fn(() => 'group-over-program');
        engine._render = jest.fn();
        engine._replaceSkin = jest.fn();

        engine.beginGroup();
        expect(engine.groupStack.length).toBe(1);
        engine.endGroup();

        expect(engine._render).toHaveBeenCalledWith('group-over-program', 'pen-framebuffer', [
            {name: 'u_image', texture: 'group-staging'}
        ], {}, []);
        expect(engine._replaceSkin).not.toHaveBeenCalled();
        expect(skin._texture).toBe('pen-texture');
        expect(skin._framebuffer).toBe(penFramebuffer);
        expect(Object.prototype.hasOwnProperty.call(skin, 'getTexture')).toBe(false);
        expect(engine.groupBufferPool).toHaveLength(1);
        expect(gl.deleteTexture).not.toHaveBeenCalled();
        expect(engine.groupStack).toEqual([]);
    });

    test('builds an expanded input only for explicitly expanded grouped effects', () => {
        const gl = {
            ARRAY_BUFFER: 1,
            BLEND: 2,
            COLOR_BUFFER_BIT: 4,
            DEPTH_TEST: 5,
            FRAMEBUFFER: 6,
            FUNC_ADD: 7,
            ONE: 8,
            ONE_MINUS_SRC_ALPHA: 9,
            SCISSOR_TEST: 10,
            STATIC_DRAW: 11,
            STENCIL_TEST: 12,
            TEXTURE0: 13,
            VERTEX_SHADER: 14,
            activeTexture: jest.fn(),
            bindBuffer: jest.fn(),
            bindFramebuffer: jest.fn(),
            blendEquation: jest.fn(),
            blendFunc: jest.fn(),
            bufferData: jest.fn(),
            clear: jest.fn(),
            clearColor: jest.fn(),
            colorMask: jest.fn(),
            compileShader: jest.fn(),
            createBuffer: jest.fn(() => ({})),
            createShader: jest.fn(() => ({})),
            deleteFramebuffer: jest.fn(),
            deleteTexture: jest.fn(),
            disable: jest.fn(),
            enable: jest.fn(),
            getShaderParameter: jest.fn(() => true),
            shaderSource: jest.fn()
        };
        const penFramebuffer = {framebuffer: 'pen-framebuffer'};
        const skin = {
            _framebuffer: penFramebuffer,
            _size: [480, 360],
            _texture: 'pen-texture'
        };
        const renderer = {
            _allSkins: {1: skin},
            _doExitDrawRegion: jest.fn(),
            _gl: gl,
            _penSkinId: 1
        };
        const PenFX = createPenFXClass({runtime: {renderer}});
        const engine = new PenFX()._getEngine();
        engine.width = 480;
        engine.height = 360;
        engine.framebuffers = ['engine-framebuffer'];
        engine.textures = ['engine-texture'];
        engine._createBufferTexture = jest.fn()
            .mockReturnValueOnce({framebuffer: 'group-framebuffer', texture: 'group-staging'})
            .mockReturnValueOnce({framebuffer: 'expanded-framebuffer', texture: 'expanded-source'});
        engine._program = jest.fn(name => `${name}-program`);
        engine._render = jest.fn();
        engine._replaceSkin = jest.fn();

        engine.beginGroup();
        engine.groupEffectScope = 'expanded';

        expect(engine._getGroupEffectSource(skin)).toBe('expanded-source');
        expect(engine._render).toHaveBeenCalledWith('groupOver-program', 'expanded-framebuffer', [
            {name: 'u_base', texture: 'pen-texture'},
            {name: 'u_effect', texture: 'group-staging'}
        ], {u_blend: 0, u_opacity: 1}, ['u_blend']);
        engine._markExpandedGroupOutput(skin);

        engine.endGroup();

        expect(engine._render).toHaveBeenCalledWith('composite-program', 'engine-framebuffer', [
            {name: 'u_base', texture: 'pen-texture'},
            {name: 'u_effect', texture: 'group-staging'}
        ], {u_blend: 0, u_opacity: 1}, ['u_blend']);
        expect(engine.groupBufferPool.map(buffer => buffer.texture)).toEqual(['group-staging', 'expanded-source']);
    });

    test('captures source and matte layers before compositing a luma matte over the baseline', () => {
        const gl = {
            ARRAY_BUFFER: 1,
            BLEND: 2,
            COLOR_BUFFER_BIT: 4,
            DEPTH_TEST: 5,
            FRAMEBUFFER: 6,
            FUNC_ADD: 7,
            ONE: 8,
            ONE_MINUS_SRC_ALPHA: 9,
            SCISSOR_TEST: 10,
            STATIC_DRAW: 11,
            STENCIL_TEST: 12,
            TEXTURE0: 13,
            VERTEX_SHADER: 14,
            activeTexture: jest.fn(),
            bindBuffer: jest.fn(),
            bindFramebuffer: jest.fn(),
            blendEquation: jest.fn(),
            blendFunc: jest.fn(),
            bufferData: jest.fn(),
            clear: jest.fn(),
            clearColor: jest.fn(),
            colorMask: jest.fn(),
            compileShader: jest.fn(),
            createBuffer: jest.fn(() => ({})),
            createShader: jest.fn(() => ({})),
            deleteFramebuffer: jest.fn(),
            deleteTexture: jest.fn(),
            disable: jest.fn(),
            enable: jest.fn(),
            getShaderParameter: jest.fn(() => true),
            shaderSource: jest.fn()
        };
        const penFramebuffer = {framebuffer: 'pen-framebuffer'};
        const skin = {
            _framebuffer: penFramebuffer,
            _size: [480, 360],
            _texture: 'pen-texture'
        };
        const renderer = {
            _allSkins: {1: skin},
            _doExitDrawRegion: jest.fn(),
            _gl: gl,
            _penSkinId: 1
        };
        const PenFX = createPenFXClass({runtime: {renderer}});
        const engine = new PenFX()._getEngine();
        engine.width = 480;
        engine.height = 360;
        engine.framebuffers = ['engine-framebuffer'];
        engine.textures = ['engine-texture'];
        engine._createBufferTexture = jest.fn()
            .mockReturnValueOnce({framebuffer: 'source-framebuffer', texture: 'source-texture'})
            .mockReturnValueOnce({framebuffer: 'matte-framebuffer', texture: 'matte-texture'});
        engine._program = jest.fn(() => 'matte-over-program');
        engine._render = jest.fn();
        engine._replaceSkin = jest.fn();

        expect(engine.beginMatte()).toBe(true);
        expect(skin._texture).toBe('source-texture');
        expect(skin.getTexture()).toBe('pen-texture');
        expect(engine.beginMatteMask()).toBe(true);
        expect(skin._texture).toBe('matte-texture');
        expect(engine.endMatte({mode: 'luma'})).toBe(true);

        expect(engine._render).toHaveBeenCalledWith('matte-over-program', 'engine-framebuffer', [
            {name: 'u_base', texture: 'pen-texture'},
            {name: 'u_source', texture: 'source-texture'},
            {name: 'u_matte', texture: 'matte-texture'}
        ], {u_mode: 1}, ['u_mode']);
        expect(engine._replaceSkin).toHaveBeenCalledWith(skin, 'engine-texture');
        expect(skin._texture).toBe('pen-texture');
        expect(Object.prototype.hasOwnProperty.call(skin, 'getTexture')).toBe(false);
        expect(gl.deleteFramebuffer).toHaveBeenCalledWith('source-framebuffer');
        expect(gl.deleteFramebuffer).toHaveBeenCalledWith('matte-framebuffer');
        expect(engine.matteStack).toEqual([]);
    });

    test('exposes Pen frame transaction boundaries to timeline rendering', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {
            beginFrame: jest.fn(() => true),
            cancelFrame: jest.fn(() => true),
            commitFrame: jest.fn(() => true)
        };

        expect(penFX.beginFrame()).toBe(true);
        expect(penFX.commitFrame()).toBe(true);
        expect(penFX.cancelFrame()).toBe(true);
        expect(penFX.engine.beginFrame).toHaveBeenCalledTimes(1);
        expect(penFX.engine.commitFrame).toHaveBeenCalledTimes(1);
        expect(penFX.engine.cancelFrame).toHaveBeenCalledTimes(1);
    });

    test('draws the default background synchronously into the Pen layer', () => {
        const pen = {_getPenLayerID: jest.fn(() => 1)};
        const vm = {runtime: {ext_pen: pen, renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {drawDefaultBackground: jest.fn(() => true)};

        const result = penFX.drawDefaultBackground([1, 1, 1, 1]);

        expect(result).toBeUndefined();
        expect(pen._getPenLayerID).toHaveBeenCalledTimes(1);
        expect(penFX.engine.drawDefaultBackground).toHaveBeenCalledWith([1, 1, 1, 1]);
    });

    test('captures grouped effects without running them early', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {color: jest.fn()};

        penFX.beginEffectCapture();
        penFX.contrast({VALUE: 2, PIVOT: 0.5, MIX: 100});
        const effects = penFX.endEffectCapture();
        expect(penFX.engine.color).not.toHaveBeenCalled();

        penFX.applyCapturedEffects(effects);
        expect(penFX.engine.color).toHaveBeenCalledTimes(1);
    });

    test('captures expanded scope for coordinate-based grouped effects', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        const scopes = [];
        penFX.engine = {
            _restoreGLState: jest.fn(),
            digitalGlitch: jest.fn(() => scopes.push(penFX.engine.groupEffectScope))
        };

        penFX.beginEffectCapture();
        penFX.glitch({MIX: 100});
        const effects = penFX.endEffectCapture();

        expect(effects).toHaveLength(1);
        expect(effects[0].groupEffectScope).toBe('expanded');
        expect(penFX.engine.digitalGlitch).not.toHaveBeenCalled();

        penFX.applyCapturedEffects(effects);

        expect(scopes).toEqual(['expanded']);
        expect(penFX.engine.groupEffectScope).toBeUndefined();
    });

    test('snapshots HSL adjust arguments when a grouped effect is captured', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {colorSpaceAdjust: jest.fn()};
        const args = {
            HADD: 0,
            HMUL: 1,
            SADD: 0,
            SMUL: 1,
            LADD: 0,
            LMUL: 1,
            MIX: 100
        };

        penFX.beginEffectCapture();
        penFX.colorSpaceAdjust(args);
        args.HADD = 0.2;
        const effects = penFX.endEffectCapture();
        penFX.applyCapturedEffects(effects);

        expect(penFX.engine.colorSpaceAdjust).toHaveBeenCalledWith(0, 1, 0, 1, 0, 1, 1, 'normal');
    });

    test('routes polar stretch, sort, and turbulent wavy controls to the GPU engine', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {
            pixelStretch: jest.fn(),
            pixelSort: jest.fn(),
            wavy: jest.fn()
        };

        penFX.pixelStretch({TYPE: 'size', POSITION: 20, SIZE: 140, SAMPLE: 5, CENTERX: 12, CENTERY: -8, MIX: 70});
        penFX.pixelSort({TYPE: 'dir', SPAN: 80, MIN: 0.2, MAX: 0.8, INVERT: 'false', SORTBY: 'hue',
            REVERSE: 'true', GAMMA: 1.2, CENTERX: 10, CENTERY: -5, MIX: 65});
        penFX.wavy({TYPE: 'dir', VALUE: 14, SIZE: 72, COMPLEXITY: 5, EVOLUTION: 180, SEED: 4,
            X: 8, Y: -3, CENTERX: 16, CENTERY: 9, MIX: 90});

        expect(penFX.engine.pixelStretch).toHaveBeenCalledWith('size', 20, 140, 5, 12, -8, 0.7, 'normal');
        expect(penFX.engine.pixelSort).toHaveBeenCalledWith('dir', 80, false, 0.2, 0.8, 'hue', true, 1.2,
            10, -5, 0.65, 'normal');
        expect(penFX.engine.wavy).toHaveBeenCalledWith(14, 4, 8, -3, 72, 5, 180, 'dir', 16, 9, 0.9, 'normal');
    });

    test('routes edge background and duplicate transform controls to the GPU engine', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {
            edgeDetection: jest.fn(),
            geometry: jest.fn()
        };

        penFX.edgeDetection({THRESHOLD: 0.2, VALUE: 2, RADIUS: 3, SOFTNESS: 0.04,
            COLOR: '#ff0000', BACKGROUND: '#204080', ALPHA: 75, MIX: 60});
        penFX.duplicate({X: 12, Y: -8, SIZE: 40, DIR: 30, ANCHORX: 4, ANCHORY: 6, MIX: 80});

        expect(penFX.engine.edgeDetection).toHaveBeenCalledWith(0.2, 2, 3, 0.04,
            [1, 0, 0], [32 / 255, 64 / 255, 128 / 255], true, 0.75, 0.6, 'normal');
        expect(penFX.engine.geometry).toHaveBeenCalledWith(4, 0, {
            offset: [12, -8], size: 40, direction: 30, anchor: [4, 6], mix: 0.8
        }, 'normal');
    });

    test('keeps legacy edge detection blocks transparent when no background input exists', () => {
        const vm = {runtime: {renderer: {}}};
        const PenFX = createPenFXClass(vm);
        const penFX = new PenFX();
        penFX.engine = {edgeDetection: jest.fn()};

        penFX.edgeDetection({THRESHOLD: 0.1, VALUE: 1, RADIUS: 1, SOFTNESS: 0.02,
            COLOR: '#000000', ALPHA: 100, MIX: 100});

        expect(penFX.engine.edgeDetection).toHaveBeenCalledWith(0.1, 1, 1, 0.02,
            [0, 0, 0], [0, 0, 0], false, 1, 1, 'normal');
    });

    test('loads Pen FX automatically as a built-in extension service', () => {
        const vm = new VM();
        vm.runtime.renderer = {};

        expect(vm.extensionManager.isExtensionLoaded('penfx')).toBe(false);
        expect(installPenFX(vm)).toBe(vm);
        expect(vm.extensionManager.isBuiltinExtension('penfx')).toBe(true);
        expect(vm.extensionManager.isExtensionLoaded('penfx')).toBe(true);
        expect(installPenFX(vm)).toBe(vm);
    });
});
