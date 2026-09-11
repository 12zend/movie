import JSZip from '@turbowarp/jszip';
import fs from 'fs';
import path from 'path';
import VM from 'scratch-vm';

import installPenFX from '../../../src/lib/pen-fx';
import {
    CUSTOM_SHADER_FORMAT,
    CUSTOM_SHADER_PROJECT_KEY,
    CUSTOM_SHADER_VERSION,
    DEFAULT_SHADER_PACKAGE_ID,
    PenFXCustomShaderManager,
    createDefaultPackageShell,
    normalizePackage,
    opcodeFor,
    parseShaderZip
} from '../../../src/lib/pen-fx/custom-shaders';
import {programSources} from '../../../src/lib/pen-fx/shaders';

const fragmentSource = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_amount;
uniform vec3 u_tint;
uniform int u_mode;
uniform float u_mix;
void main() {
    vec4 pixel = texture2D(u_image, v_uv);
    vec3 changed = pixel.rgb + (u_tint * u_amount * 0.01) + vec3(float(u_mode) * 0.0);
    gl_FragColor = vec4(mix(pixel.rgb, changed, u_mix), pixel.a);
}
`;

const manifest = {
    format: CUSTOM_SHADER_FORMAT,
    version: CUSTOM_SHADER_VERSION,
    id: 'test-pack',
    name: 'Test Pack',
    blocks: [{
        id: 'tint-wave',
        name: 'tint wave',
        text: 'tint wave amount: [AMOUNT] tint: [TINT] mode: [MODE] mix: [MIX] %',
        file: 'tint-wave.glsl',
        groupEffectScope: 'expanded',
        inputs: [
            {id: 'AMOUNT', label: 'amount', type: 'number', defaultValue: 4, uniform: 'u_amount'},
            {id: 'TINT', label: 'tint', type: 'color', defaultValue: '#204080', uniform: 'u_tint'},
            {id: 'MODE', label: 'mode', type: 'menu', items: ['soft', 'hard'], uniform: 'u_mode'},
            {id: 'MIX', label: 'mix', type: 'number', defaultValue: 100, scale: 0.01, uniform: 'u_mix'}
        ]
    }]
};

const makeManifestZip = async () => {
    const zip = new JSZip();
    zip.file('shader/shading-shader.json', JSON.stringify(manifest));
    zip.file('shader/tint-wave.glsl', fragmentSource);
    return zip.generateAsync({type: 'uint8array'});
};

describe('Pen FX custom shader packages', () => {
    const defaultPackagePath = path.resolve(
        __dirname,
        '../../../scratch-vm/src/lib/pen-fx/default-shader-package/penfx-builtins.zip'
    );

    test('loads a manifest and its GLSL from a zip', async () => {
        const descriptor = await parseShaderZip(await makeManifestZip(), 'test-pack.zip');

        expect(descriptor.id).toBe('test-pack');
        expect(descriptor.name).toBe('Test Pack');
        expect(descriptor.blocks).toHaveLength(1);
        expect(descriptor.blocks[0].source).toContain('uniform float u_amount');
        expect(descriptor.blocks[0].inputs[3]).toMatchObject({
            id: 'MIX',
            scale: 0.01,
            uniform: 'u_mix'
        });
        expect(descriptor.blocks[0].groupEffectScope).toBe('expanded');
    });

    test('auto-discovers GLSL files when a manifest is omitted', async () => {
        const zip = new JSZip();
        zip.file('soft-glow.glsl', fragmentSource);
        zip.file('nested/color-shift.glsl', fragmentSource);
        const descriptor = await parseShaderZip(
            await zip.generateAsync({type: 'uint8array'}),
            'quick-effects.zip'
        );

        expect(descriptor.name).toBe('quick effects');
        expect(descriptor.blocks.map(block => block.name)).toEqual(['soft glow', 'color shift']);
        expect(descriptor.blocks.every(block => block.autoInputs)).toBe(true);
        expect(descriptor.blocks.every(block => block.inputs.map(input => input.id).join(',') ===
            'AMOUNT,TINT_X,TINT_Y,TINT_Z,MODE,MIX')).toBe(true);
    });

    test('ships every built-in PenFX block and fragment program in the default zip', async () => {
        const descriptor = await parseShaderZip(fs.readFileSync(defaultPackagePath), 'penfx-builtins.zip');

        expect(descriptor.id).toBe(DEFAULT_SHADER_PACKAGE_ID);
        expect(descriptor.blocks).toHaveLength(59);
        expect(descriptor.programs).toHaveLength(Object.keys(programSources).length);
        expect(descriptor.blocks.find(block => block.id === 'contrast')).toMatchObject({
            name: 'contrast',
            text: 'contrast value: [VALUE] pivot: [PIVOT] mix: [MIX] %',
            inputs: expect.arrayContaining([
                {id: 'VALUE', label: 'value'},
                {id: 'PIVOT', label: 'pivot'},
                {id: 'MIX', label: 'mix'}
            ])
        });
        expect(descriptor.blocks.map(block => block.opcode)).toEqual(expect.arrayContaining([
            'contrast',
            'depthOfField',
            'pixelSort',
            'displacementMap',
            'bufferStackSize'
        ]));
        expect(descriptor.blocks.find(block => block.id === 'glitch').groupEffectScope).toBe('expanded');
        for (const program of descriptor.programs) {
            expect(program.source).toBe(programSources[program.bind].trim());
        }
    });

    test('uses English names from the default zip and localizes them only for Japanese UI', () => {
        const englishVM = {runtime: {}, getLocale: () => 'en'};
        const englishManager = new PenFXCustomShaderManager(englishVM, {});
        englishManager.installDefaultPackage();
        const englishContrast = englishManager.getToolboxBlocks()
            .find(block => block && block.opcode === 'contrast');

        const japaneseVM = {runtime: {}, getLocale: () => 'ja'};
        const japaneseManager = new PenFXCustomShaderManager(japaneseVM, {});
        japaneseManager.installDefaultPackage();
        const japaneseContrast = japaneseManager.getToolboxBlocks()
            .find(block => block && block.opcode === 'contrast');

        expect(englishContrast.text).toBe('contrast value: [VALUE] pivot: [PIVOT] mix: [MIX] %');
        expect(japaneseContrast.text).toBe('コントラスト 値: [VALUE] 基準: [PIVOT] 混合: [MIX] %');
        expect(englishContrast.arguments.VALUE).toMatchObject({defaultValue: 1});
        expect(japaneseContrast.arguments.VALUE).toMatchObject({defaultValue: 1});
    });

    test('loads the default zip without making extension installation wait', async () => {
        const shell = createDefaultPackageShell();
        const runWithoutWaiting = jest.fn();
        const engine = {
            registerCustomShader: jest.fn(),
            unregisterCustomShader: jest.fn(),
            validateCustomShader: jest.fn()
        };
        const penFX = {_getEngine: () => engine};
        for (const block of shell.blocks) penFX[block.implementation.opcode] = jest.fn();
        const vm = {runtime: {movieAssetManager: {runWithoutWaiting}}};

        const manager = new PenFXCustomShaderManager(vm, penFX, {
            loadDefaultPackage: true,
            defaultPackageData: fs.readFileSync(defaultPackagePath)
        });

        expect(runWithoutWaiting).toHaveBeenCalledWith(manager.defaultPackagePromise);
        await manager.defaultPackagePromise;
        expect(manager.packages.get(DEFAULT_SHADER_PACKAGE_ID).programs).toHaveLength(26);
        expect(engine.validateCustomShader).toHaveBeenCalledTimes(26);
    });

    test('all default command delegates return undefined in the current VM tick', () => {
        const vm = new VM();
        vm.runtime.renderer = {};
        installPenFX(vm);
        const penFX = vm.runtime.penFX;
        const engineMethod = jest.fn();
        penFX.engine = new Proxy({blendOpacity: 1, _restoreGLState: jest.fn()}, {
            get: (target, property) => property in target ? target[property] : engineMethod
        });
        const commandBlocks = penFX.getInfo().blocks.filter(block => block && block.blockType === 'command');

        for (const block of commandBlocks) {
            const args = {};
            for (const id of Object.keys(block.arguments || {})) args[id] = block.arguments[id].defaultValue;
            const result = vm.runtime._primitives[`penfx_${block.opcode}`](args, {target: {}});
            expect(result).toBeUndefined();
            expect(result).not.toBeInstanceOf(Promise);
        }
        expect(commandBlocks).toHaveLength(58);
    });

    test('scopes v2 program overrides to its adapter block and survives descriptor normalization', async () => {
        const withShaderProgramOverrides = jest.fn((overrides, callback) => callback());
        const contrast = jest.fn();
        const penFX = {contrast, withShaderProgramOverrides, engine: null};
        const manager = new PenFXCustomShaderManager({runtime: {}}, penFX);
        const descriptor = normalizePackage({
            format: CUSTOM_SHADER_FORMAT,
            version: 2,
            id: 'contrast-variant',
            name: 'Contrast Variant',
            programs: [{
                id: 'color',
                file: 'color.glsl',
                source: fragmentSource,
                bind: 'color'
            }],
            blocks: [{
                id: 'contrast',
                name: 'contrast',
                text: 'contrast',
                implementation: {type: 'penfx', opcode: 'contrast'}
            }]
        });

        await manager.restorePackages([JSON.parse(JSON.stringify(descriptor))]);
        penFX[opcodeFor('contrast-variant', 'contrast')]({}, {});

        expect(contrast).toHaveBeenCalledTimes(1);
        expect(withShaderProgramOverrides).toHaveBeenCalledWith({
            color: 'custom:contrast-variant:program:color'
        }, expect.any(Function));
    });

    test('propagates expanded scope through implementation blocks', async () => {
        const implementation = jest.fn();
        const withGroupEffectScope = jest.fn((scope, callback) => callback());
        const penFX = {
            engine: null,
            contrast: implementation,
            withGroupEffectScope
        };
        const manager = new PenFXCustomShaderManager({runtime: {}}, penFX);
        const descriptor = normalizePackage({
            format: CUSTOM_SHADER_FORMAT,
            version: 2,
            id: 'expanded-adapter',
            name: 'Expanded Adapter',
            blocks: [{
                id: 'expanded',
                name: 'expanded',
                text: 'expanded',
                groupEffectScope: 'expanded',
                implementation: {type: 'penfx', opcode: 'contrast'}
            }]
        });

        await manager.restorePackages([descriptor]);
        penFX[opcodeFor('expanded-adapter', 'expanded')]({}, {});

        expect(withGroupEffectScope).toHaveBeenCalledWith('expanded', expect.any(Function));
        expect(implementation).toHaveBeenCalledTimes(1);
    });

    test('rejects manifest inputs which target standard uniforms', () => {
        const invalid = JSON.parse(JSON.stringify(manifest));
        invalid.blocks[0].source = fragmentSource;
        invalid.blocks[0].inputs[0].uniform = 'u_time';

        expect(() => normalizePackage(invalid)).toThrow('invalid or reserved uniform u_time');
    });

    test('creates native toolbox UI and executes imported command blocks synchronously', async () => {
        const customShader = jest.fn();
        const vm = {
            runtime: {
                movieAssetManager: {timeline: {currentTime: 1.5, framerate: 24}}
            }
        };
        const penFX = {
            blendMode: 'normal',
            engine: null,
            _safe: callback => callback({customShader})
        };
        const manager = new PenFXCustomShaderManager(vm, penFX);
        const descriptor = JSON.parse(JSON.stringify(manifest));
        descriptor.blocks[0].source = fragmentSource;
        await manager.restorePackages([descriptor]);

        const toolbox = manager.getToolboxBlocks();
        expect(toolbox[0]).toMatchObject({blockType: 'label', text: 'Custom Shaders'});
        expect(toolbox[1]).toMatchObject({blockType: 'button', text: 'Import shader'});
        expect(toolbox.find(block => block && block.opcode === 'shader_test_pack_tint_wave')).toBeDefined();

        const result = penFX[opcodeFor('test-pack', 'tint-wave')]({
            AMOUNT: 8,
            TINT: '#204080',
            MODE: 'hard',
            MIX: 50
        });

        expect(result).toBeUndefined();
        expect(customShader).toHaveBeenCalledWith('custom:test-pack:tint-wave', {
            u_resolution: [0, 0],
            u_time: 1.5,
            u_frame: 36,
            u_amount: 8,
            u_tint: [32 / 255, 64 / 255, 128 / 255],
            u_mode: 1,
            u_mix: 0.5
        }, ['u_frame', 'u_mode'], 'normal');
    });

    test('registers imported command primitives which return undefined to the Scratch VM', async () => {
        const vm = new VM();
        vm.runtime.renderer = {};
        installPenFX(vm);
        const penFX = vm.runtime.penFX;
        const descriptor = JSON.parse(JSON.stringify(manifest));
        descriptor.blocks[0].source = fragmentSource;
        await penFX.customShaders.restorePackages([descriptor]);
        penFX.engine = {
            blendOpacity: 1,
            customShader: jest.fn(),
            _restoreGLState: jest.fn()
        };

        const primitive = vm.runtime._primitives.penfx_shader_test_pack_tint_wave;
        expect(primitive({AMOUNT: 4, TINT: '#ffffff', MODE: 'soft', MIX: 100}, {})).toBeUndefined();
        expect(penFX.engine.customShader).toHaveBeenCalledTimes(1);
    });

    test('embeds packages in project JSON and restores them before project deserialization', async () => {
        const callOrder = [];
        const vm = {
            runtime: {},
            extensionManager: {
                isExtensionLoaded: () => true,
                refreshBlocks: jest.fn(async () => callOrder.push('refresh'))
            },
            toJSON: () => JSON.stringify({targets: []}),
            deserializeProject: async () => callOrder.push('deserialize')
        };
        const penFX = {engine: null};
        const manager = new PenFXCustomShaderManager(vm, penFX);
        const descriptor = JSON.parse(JSON.stringify(manifest));
        descriptor.blocks[0].source = fragmentSource;
        await manager.restorePackages([descriptor]);

        const saved = JSON.parse(vm.toJSON());
        expect(saved[CUSTOM_SHADER_PROJECT_KEY]).toHaveLength(1);
        expect(saved.mb3.features).toContain('pen-fx-shaders');

        callOrder.length = 0;
        await vm.deserializeProject(saved);
        expect(callOrder).toEqual(['refresh', 'deserialize']);
    });

    test('creates and updates one editable block with automatically discovered uniforms', async () => {
        const customShader = jest.fn();
        const engine = {
            customShader,
            registerCustomShader: jest.fn(),
            unregisterCustomShader: jest.fn(),
            validateCustomShader: jest.fn()
        };
        const vm = {
            runtime: {
                emitProjectChanged: jest.fn(),
                movieAssetManager: {timeline: {currentTime: 2, framerate: 30}}
            },
            extensionManager: {
                isExtensionLoaded: () => true,
                refreshBlocks: jest.fn(async () => undefined)
            }
        };
        const penFX = {
            blendMode: 'normal',
            engine: null,
            _getEngine: () => {
                penFX.engine = engine;
                return engine;
            },
            _safe: callback => callback(engine)
        };
        const manager = new PenFXCustomShaderManager(vm, penFX);
        const source = `
            precision highp float;
            varying vec2 v_uv;
            uniform sampler2D u_image;
            uniform vec2 u_offset;
            uniform bool u_enabled;
            void main() { gl_FragColor = texture2D(u_image, v_uv + u_offset); }
        `;

        const created = await manager.createShader({name: 'Offset', source});
        expect(created.inputs.map(input => input.id)).toEqual(['OFFSET_X', 'OFFSET_Y', 'ENABLED']);
        expect(manager.getToolboxBlocks().find(block => block && block.opcode === 'shader_offset_main')).toMatchObject({
            text: 'Offset offset x: [OFFSET_X] offset y: [OFFSET_Y] enabled: [ENABLED]',
            arguments: {
                OFFSET_X: {type: 'number', defaultValue: 0},
                OFFSET_Y: {type: 'number', defaultValue: 0},
                ENABLED: {type: 'Boolean', defaultValue: false}
            }
        });

        const result = penFX[opcodeFor('offset', 'main')]({
            OFFSET_X: 0.25,
            OFFSET_Y: -0.5,
            ENABLED: true
        });
        expect(result).toBeUndefined();
        expect(result).not.toBeInstanceOf(Promise);
        expect(customShader).toHaveBeenCalledWith('custom:offset:main', {
            u_resolution: [0, 0],
            u_time: 2,
            u_frame: 60,
            u_offset: [0.25, -0.5],
            u_enabled: 1
        }, ['u_frame', 'u_enabled'], 'normal');

        const updated = await manager.updateShader(created.key, {
            name: 'Offset Plus',
            source: source.replace('uniform bool u_enabled;', 'uniform bool u_enabled; uniform float u_amount;')
        });
        expect(updated.name).toBe('Offset Plus');
        expect(updated.inputs.map(input => input.id)).toEqual(['OFFSET_X', 'OFFSET_Y', 'ENABLED', 'AMOUNT']);
        expect(manager.serializePackages()[0].blocks[0].source).toContain('uniform float u_amount');
        expect(vm.runtime.emitProjectChanged).toHaveBeenCalledTimes(2);
    });

    test('keeps the previous editable shader when an update does not compile', async () => {
        const engine = {
            registerCustomShader: jest.fn(),
            unregisterCustomShader: jest.fn(),
            validateCustomShader: jest.fn(source => {
                if (source.indexOf('broken') !== -1) throw new Error('compile failed');
            })
        };
        const penFX = {
            engine: null,
            _getEngine: () => {
                penFX.engine = engine;
                return engine;
            }
        };
        const manager = new PenFXCustomShaderManager({runtime: {}}, penFX);
        const created = await manager.createShader({name: 'Safe Shader', source: fragmentSource});

        await expect(manager.updateShader(created.key, {
            source: `${fragmentSource}\n// broken`
        })).rejects.toThrow('compile failed');
        expect(manager.getShader(created.key).source).toBe(fragmentSource.trim());
    });

});
