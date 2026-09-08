jest.mock('scratch-render-fonts', () => () => ({}), {virtual: true});

import JSZip from '@turbowarp/jszip';
import VM from 'scratch-vm';
import sb3 from 'scratch-vm/src/serialization/sb3';

import installMovieAssetManager from '../../../src/lib/movie-asset-manager';
import installMyBlocksShader from '../../../src/lib/my-blocks-shader';

const projectJSON = {
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {
            initialize: {
                opcode: 'event_initialize',
                next: 'command',
                parent: null,
                inputs: {},
                fields: {},
                shadow: false,
                topLevel: true,
                x: 10,
                y: 20
            },
            command: {
                opcode: 'looks_settextfont',
                next: null,
                parent: 'initialize',
                inputs: {
                    FONT: [1, [10, 'Movie Sans']],
                    TEXT: [1, [10, 'hello']]
                },
                fields: {},
                shadow: false,
                topLevel: false
            }
        },
        comments: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null
    }],
    monitors: [],
    extensions: [],
    meta: {
        semver: '3.0.0',
        vm: '0.2.0',
        agent: ''
    }
};

const shaderBlock = (opcode, overrides = {}) => Object.assign({
    opcode,
    next: null,
    parent: null,
    inputs: {},
    fields: {},
    shadow: false,
    topLevel: false
}, overrides);

const makeShaderProjectJSON = () => {
    const shaderMutation = {
        tagName: 'mutation',
        children: [],
        myblocksshader: 'true',
        shaderid: 'shader-id',
        shaderuserproccode: 'shade %s',
        shaderuserargumentids: '["amount"]',
        shaderuserargumentnames: '["amount"]',
        shaderuserargumentdefaults: '["1"]',
        shadercoordids: '["cx-id","cy-id"]',
        proccode: 'shade %s %s %s',
        argumentids: '["amount","cx-id","cy-id"]',
        argumentnames: '["amount","cx","cy"]',
        argumentdefaults: '["1","0","0"]',
        warp: 'true'
    };
    const blocks = {
        definition: shaderBlock('procedures_definition', {
            next: 'return',
            inputs: {custom_block: {block: 'prototype', shadow: 'prototype'}},
            topLevel: true,
            x: 10,
            y: 20
        }),
        prototype: shaderBlock('procedures_prototype', {
            parent: 'definition',
            mutation: shaderMutation,
            shadow: true
        }),
        return: shaderBlock('myblocksshader_return', {
            parent: 'definition',
            inputs: {
                R: {block: 'get-r', shadow: null},
                G: {block: 'get-g', shadow: null},
                B: {block: 'get-b', shadow: null}
            }
        }),
        'get-r': shaderBlock('myblocksshader_get_r', {parent: 'return'}),
        'get-g': shaderBlock('myblocksshader_get_g', {parent: 'return'}),
        'get-b': shaderBlock('myblocksshader_get_b', {parent: 'return'}),
        'return-from': shaderBlock('myblocksshader_return_from', {
            topLevel: true,
            x: 10,
            y: 260
        }),
        call: shaderBlock('procedures_call', {
            mutation: {
                tagName: 'mutation',
                children: [],
                myblocksshader: 'true',
                shaderid: 'shader-id',
                shaderproccode: 'shade %s %s %s',
                proccode: 'shade %s',
                argumentids: '["amount"]',
                argumentnames: '["amount"]',
                argumentdefaults: '["1"]',
                warp: 'true'
            },
            topLevel: true,
            x: 10,
            y: 180
        })
    };
    const [serializedBlocks] = sb3.serializeBlocks(blocks);
    const json = JSON.parse(JSON.stringify(projectJSON));
    json.targets[0].blocks = serializedBlocks;
    return json;
};

describe('Movie project save and load', () => {
    test('keeps custom blocks in a marked project.json inside a shade-compatible ZIP', async () => {
        const vm = new VM();
        installMovieAssetManager(vm);
        await vm.loadProject(JSON.stringify(projectJSON));

        const archive = await vm.saveProjectSb3('arraybuffer');
        const zip = await JSZip.loadAsync(archive);
        const savedJSON = JSON.parse(await zip.file('project.json').async('string'));

        expect(savedJSON.mb3).toEqual({version: 1, features: ['movie-blocks', 'timeline']});
        const savedBlock = Object.values(savedJSON.targets[0].blocks)
            .find(item => item.opcode === 'looks_settextfont');
        expect(savedBlock).toBeDefined();
        expect(Object.values(savedJSON.targets[0].blocks)
            .some(item => item.opcode === 'event_initialize')).toBe(true);

        const reloadedVM = new VM();
        installMovieAssetManager(reloadedVM);
        await reloadedVM.loadProject(archive);

        const loadedBlock = Object.values(reloadedVM.runtime.targets[0].blocks._blocks)
            .find(item => item.opcode === 'looks_settextfont');
        expect(loadedBlock.opcode).toBe('looks_settextfont');
        expect(reloadedVM.runtime.getIsHat('event_initialize')).toBe(true);
        expect(reloadedVM.runtime._primitives.looks_settextfont).toEqual(expect.any(Function));
    });

    test('round-trips My Blocks Shader definitions, calls and built-in blocks', async () => {
        const vm = new VM();
        installMovieAssetManager(vm);
        installMyBlocksShader(vm);
        await vm.loadProject(JSON.stringify(makeShaderProjectJSON()));

        expect(vm.extensionManager.isExtensionLoaded('myblocksshader')).toBe(true);
        const archive = await vm.saveProjectSb3('arraybuffer');
        const zip = await JSZip.loadAsync(archive);
        const savedJSON = JSON.parse(await zip.file('project.json').async('string'));
        expect(savedJSON.mb3).toEqual({version: 1, features: ['my-blocks-shader', 'timeline']});

        const reloadedVM = new VM();
        installMovieAssetManager(reloadedVM);
        installMyBlocksShader(reloadedVM);
        await reloadedVM.loadProject(archive);

        const loadedBlocks = Object.values(reloadedVM.runtime.targets[0].blocks._blocks);
        expect(loadedBlocks.map(block => block.opcode)).toEqual(expect.arrayContaining([
            'procedures_definition',
            'procedures_prototype',
            'procedures_call',
            'myblocksshader_return',
            'myblocksshader_return_from',
            'myblocksshader_get_r',
            'myblocksshader_get_g',
            'myblocksshader_get_b'
        ]));
        const loadedPrototype = loadedBlocks.find(block => block.opcode === 'procedures_prototype');
        const loadedCall = loadedBlocks.find(block => block.opcode === 'procedures_call');
        expect(loadedPrototype.mutation).toEqual(expect.objectContaining({
            myblocksshader: 'true',
            shaderid: 'shader-id',
            shaderuserproccode: 'shade %s'
        }));
        expect(loadedCall.mutation).toEqual(expect.objectContaining({
            myblocksshader: 'true',
            shaderid: 'shader-id'
        }));
        expect(reloadedVM.runtime._primitives.myblocksshader_return({}, {})).toBeUndefined();
        expect(reloadedVM.runtime._primitives.myblocksshader_return_from({}, {})).toBeUndefined();
    });
});
