import VM from 'scratch-vm';
import ArgumentType from 'scratch-vm/src/extension-support/argument-type';
import RenderedTarget from 'scratch-vm/src/sprites/rendered-target';
import Sprite from 'scratch-vm/src/sprites/sprite';

import installObjectBlocks, {
    ANIMATION_EASING_TYPES,
    BLEND_MODES,
    COSTUME_GROUP_SOURCE,
    MATTE_MODES,
    PRIMARY,
    SECONDARY,
    TERTIARY,
    applyObjectTransforms,
    createObjectBlocksClass,
    decodeDrawAsset,
    encodeDrawAsset
} from '../../../src/lib/object-blocks';
import {
    FRAME_GRAPH_NODE_TYPES,
    MovieFrameGraphRenderer
} from '../../../src/lib/movie-frame-graph';
import installObjectBlockDefinitions, {
    deleteAsset,
    drawSelectionUsesFrame,
    getDrawInputVisibility,
    getAssetItems,
    getFieldSourceBlock,
    modelHasFrames,
    normalizeVideoMode,
    openImportPicker
} from '../../../src/lib/object-blocks-ui';

const makeUtil = () => ({
    stackFrame: {},
    startBranch: jest.fn(),
    target: {id: 'sprite'},
    thread: {peekStack: jest.fn(() => 'draw-block')}
});

const makeGroupingHarness = onStep => {
    const blocks = {
        getBranch: jest.fn((blockId, branch) => {
            if (blockId !== 'grouping') return null;
            return branch === 1 ? 'objects-branch' : 'effects-branch';
        })
    };
    const target = {id: 'sprite', blocks};
    const parentThread = {
        blockContainer: blocks,
        peekStack: jest.fn(() => 'grouping'),
        target
    };
    const originalActiveThread = {id: 'original'};
    const sequencer = {
        activeThread: originalActiveThread,
        stepThread: jest.fn(thread => {
            if (onStep) onStep(thread);
        })
    };
    return {
        originalActiveThread,
        runtime: {sequencer},
        sequencer,
        util: {
            stackFrame: {},
            startBranch: jest.fn(),
            target,
            thread: parentThread
        }
    };
};

describe('Objects blocks', () => {
    test('styles the legacy lighting opcodes as Objects blocks', () => {
        const ScratchBlocks = {Blocks: {}};
        installObjectBlockDefinitions(ScratchBlocks, {runtime: {}});

        ['looks_clearlight', 'looks_addpointlight', 'looks_addlight'].forEach(opcode => {
            const block = {jsonInit: jest.fn()};
            ScratchBlocks.Blocks[opcode].init.call(block);
            expect(block.jsonInit).toHaveBeenCalledWith(expect.objectContaining({
                category: 'Objects',
                colour: PRIMARY,
                colourSecondary: SECONDARY,
                colourTertiary: TERTIARY
            }));
        });
    });

    test('localizes Object block definitions in Japanese mode', () => {
        const ScratchBlocks = {Blocks: {}};
        const vm = {getLocale: () => 'ja', runtime: {}};
        installObjectBlockDefinitions(ScratchBlocks, vm);

        const legacyBlock = {jsonInit: jest.fn()};
        ScratchBlocks.Blocks.looks_clearlight.init.call(legacyBlock);
        expect(legacyBlock.jsonInit).toHaveBeenCalledWith(expect.objectContaining({
            category: 'レイヤー'
        }));

        const groupingBlock = {jsonInit: jest.fn()};
        ScratchBlocks.Blocks.objects_grouping.init.call(groupingBlock);
        expect(groupingBlock.jsonInit).toHaveBeenCalledWith(expect.objectContaining({
            message0: 'グループ化',
            message2: 'エフェクト',
            category: 'レイヤー'
        }));
    });

    test('shows the shape ratio input only for star, curved star, and flower', () => {
        const ScratchBlocks = {
            Blocks: {},
            FieldDropdown: class {}
        };
        installObjectBlockDefinitions(ScratchBlocks, {runtime: {}});
        const definition = ScratchBlocks.Blocks.objects_shape;
        const makeBlock = initialShape => {
            let shape = initialShape;
            const inputs = {};
            const field = {setValue: jest.fn(value => {
                shape = value;
            })};
            const makeInput = () => {
                const input = {
                    connection: null,
                    setVisible: jest.fn(() => []),
                    appendField: jest.fn(() => input)
                };
                return input;
            };
            const block = {
                appendDummyInput: jest.fn(name => {
                    const input = makeInput();
                    inputs[name] = input;
                    return input;
                }),
                appendValueInput: jest.fn(name => {
                    const input = makeInput();
                    inputs[name] = input;
                    return input;
                }),
                getField: jest.fn(name => name === 'SHAPE' ? field : null),
                getFieldValue: jest.fn(name => name === 'SHAPE' ? shape : ''),
                getInput: name => inputs[name],
                rendered: false,
                setColour: jest.fn(),
                setInputsInline: jest.fn(),
                setNextStatement: jest.fn(),
                setOnChange: jest.fn(handler => {
                    block.onChange = handler;
                }),
                setOutputShape: jest.fn(),
                setPreviousStatement: jest.fn()
            };
            definition.init.call(block);
            return {block, ratioInput: inputs.RATIO};
        };

        const polygon = makeBlock('polygon');
        expect(polygon.ratioInput.setVisible).toHaveBeenLastCalledWith(false);

        const star = makeBlock('star');
        expect(star.ratioInput.setVisible).toHaveBeenLastCalledWith(true);

        const curvedStar = makeBlock('curved star');
        expect(curvedStar.ratioInput.setVisible).toHaveBeenLastCalledWith(true);

        const changing = makeBlock('polygon');
        changing.block.onChange();
        expect(changing.ratioInput.setVisible).toHaveBeenLastCalledWith(false);
        changing.block.getFieldValue.mockImplementation(name => name === 'SHAPE' ? 'flower' : '');
        changing.block.onChange();
        expect(changing.ratioInput.setVisible).toHaveBeenLastCalledWith(true);
    });

    test('persists and restores the dynamic text input for duplicated and shared font draw blocks', () => {
        const originalDocument = global.document;
        global.document = {
            createElement: name => {
                const attributes = new Map();
                return {
                    getAttribute: key => attributes.has(key) ? attributes.get(key) : null,
                    nodeName: name,
                    setAttribute: (key, value) => attributes.set(key, String(value))
                };
            }
        };
        const ScratchBlocks = {
            Blocks: {},
            Events: {isEnabled: () => false},
            FieldDropdown: class {},
            FieldLabel: class {},
            Xml: {domToText: element => element.outerHTML}
        };
        const vm = {runtime: {}};
        installObjectBlockDefinitions(ScratchBlocks, vm);
        const definition = ScratchBlocks.Blocks.objects_draw;
        const makeBlock = (initialSource, initialAsset) => {
            let source = initialSource;
            const visibility = {};
            const fields = {
                ASSET: {setValue: jest.fn()},
                SOURCE: {
                    setValue: jest.fn(value => {
                        source = value;
                    })
                }
            };
            return Object.assign({
                getField: name => fields[name],
                getFieldValue: name => {
                    if (name === 'ASSET') return encodeDrawAsset(source, initialAsset);
                    if (name === 'SOURCE') return source;
                    if (name === 'VIDEO_MODE') return 'sequence';
                    return '';
                },
                getInput: name => ({
                    connection: null,
                    setVisible: value => {
                        visibility[name] = value;
                        return [];
                    }
                }),
                objectDrawAsset_: initialAsset,
                objectDrawSource_: source,
                objectDrawVideoMode_: 'sequence',
                rendered: false,
                visibility
            }, definition);
        };
        try {
            const original = makeBlock('text', 'sans-serif');
            const mutation = original.mutationToDom();
            const restored = makeBlock('costume', 'costume1');

            restored.domToMutation(mutation);

            expect(mutation.getAttribute('source')).toBe('text');
            expect(mutation.getAttribute('asset')).toBe('sans-serif');
            expect(restored.objectDrawSource_).toBe('text');
            expect(restored.objectDrawAsset_).toBe('sans-serif');
            expect(restored.visibility.TEXT).toBe(true);
        } finally {
            global.document = originalDocument;
        }
    });

    test('supports the legacy ScratchBlocks field source API', () => {
        const sourceBlock = {};

        expect(getFieldSourceBlock({sourceBlock_: sourceBlock})).toBe(sourceBlock);
        expect(getFieldSourceBlock({getSourceBlock: () => sourceBlock})).toBe(sourceBlock);
    });

    test('marks project media as deletable while protecting built-in fonts and the last costume', () => {
        const costume = {name: 'only image'};
        const target = {
            getCostumes: () => [costume],
            id: 'sprite'
        };
        const vm = {
            editingTarget: target,
            runtime: {
                fontManager: {
                    getFonts: () => [{family: 'Project Font', name: 'Project Font'}]
                },
                movieAssetManager: {
                    getModels: () => [{name: 'model'}],
                    getVideos: () => [{name: 'video', url: 'blob:video'}]
                }
            }
        };

        const items = getAssetItems(vm);

        expect(items.find(item => item.source === 'costume')).toMatchObject({
            deletable: false,
            index: 0
        });
        expect(items.find(item => item.name === 'Sans Serif')).toMatchObject({deletable: false});
        expect(items.find(item => item.name === 'Project Font')).toMatchObject({
            deletable: true,
            index: 0
        });
        expect(items.find(item => item.source === 'video')).toMatchObject({deletable: true, index: 0});
        expect(items.find(item => item.source === 'model')).toMatchObject({deletable: true, index: 0});
    });

    test('exposes costume groups as frame-based media without replacing their source costumes', () => {
        const costumes = [
            {assetId: 'svg-one', name: 'One'},
            {assetId: 'svg-two', name: 'Two'}
        ];
        const group = {costumeAssetIds: ['svg-one', 'svg-two'], name: 'Walk'};
        const vm = {
            editingTarget: {
                getCostumes: () => costumes,
                id: 'sprite'
            },
            runtime: {
                fontManager: {getFonts: () => []},
                movieAssetManager: {
                    getCostumeGroupCostumes: jest.fn(() => costumes),
                    getCostumeGroups: jest.fn(() => [group]),
                    getModels: () => [],
                    getVideos: () => []
                }
            }
        };

        expect(getAssetItems(vm).find(item => item.source === COSTUME_GROUP_SOURCE)).toMatchObject({
            deletable: true,
            details: '2 frames',
            name: 'Walk',
            value: `${COSTUME_GROUP_SOURCE}:Walk`
        });
    });

    test('deletes each supported project media type through its owning API', () => {
        const deleteCostume = jest.fn(() => () => {});
        const manager = {
            deleteFont: jest.fn(),
            deleteModel: jest.fn(),
            deleteVideo: jest.fn()
        };
        const vm = {
            deleteCostume,
            editingTarget: {
                getCostumes: () => [{name: 'one'}, {name: 'two'}],
                id: 'sprite'
            },
            runtime: {movieAssetManager: manager}
        };

        expect(deleteAsset(vm, {deletable: true, index: 1, source: 'costume'})).toBe(true);
        expect(deleteAsset(vm, {deletable: true, index: 2, source: 'video'})).toBe(true);
        expect(deleteAsset(vm, {deletable: true, index: 3, source: 'model'})).toBe(true);
        expect(deleteAsset(vm, {deletable: true, index: 4, source: 'text'})).toBe(true);
        expect(deleteAsset(vm, {deletable: false, index: 0, source: 'text'})).toBe(false);

        expect(deleteCostume).toHaveBeenCalledWith(1);
        expect(manager.deleteVideo).toHaveBeenCalledWith('sprite', 2);
        expect(manager.deleteModel).toHaveBeenCalledWith('sprite', 3);
        expect(manager.deleteFont).toHaveBeenCalledWith(4);
    });

    test('selects an imported asset on the live block after the workspace refreshes', async () => {
        const listeners = {};
        const input = {
            addEventListener: jest.fn((name, listener) => {
                listeners[name] = listener;
            }),
            click: jest.fn(),
            files: [{name: 'new-image.png'}],
            parentNode: null,
            style: {}
        };
        const body = {
            appendChild: jest.fn(node => {
                node.parentNode = body;
            }),
            removeChild: jest.fn(node => {
                node.parentNode = null;
            })
        };
        const originalDocument = global.document;
        global.document = {
            body,
            createElement: jest.fn(() => input)
        };
        const liveBlock = {id: 'draw-block', setDrawAsset_: jest.fn()};
        const workspace = {getBlockById: jest.fn(() => null)};
        const mainWorkspace = {getBlockById: jest.fn(() => liveBlock)};
        const ScratchBlocks = {getMainWorkspace: jest.fn(() => mainWorkspace)};
        const staleBlock = {
            getFieldValue: jest.fn(name => (name === 'ASSET' ? 'costume:old' : 'costume')),
            id: 'draw-block',
            setDrawAsset_: jest.fn(),
            setWarningText: jest.fn(),
            workspace
        };
        const manager = {
            importFiles: jest.fn(() => Promise.resolve([{name: 'new-image', source: 'costume'}]))
        };
        const storedBlock = {
            fields: {
                ASSET: {value: 'costume:old'},
                SOURCE: {value: 'costume'}
            }
        };
        const blocks = {
            changeBlock: jest.fn(change => {
                storedBlock.fields[change.name].value = change.value;
            }),
            getBlock: jest.fn(() => storedBlock)
        };
        const vm = {
            editingTarget: {blocks, id: 'sprite'},
            refreshWorkspace: jest.fn(),
            runtime: {movieAssetManager: manager}
        };
        try {
            openImportPicker(vm, staleBlock, ScratchBlocks);
            listeners.change();
            await Promise.resolve();
            await Promise.resolve();

            expect(mainWorkspace.getBlockById).toHaveBeenCalledWith('draw-block');
            expect(liveBlock.setDrawAsset_).toHaveBeenCalledWith('costume', 'new-image');
            expect(staleBlock.setDrawAsset_).not.toHaveBeenCalled();
            expect(storedBlock.fields.ASSET.value).toBe('costume:new-image');
            expect(storedBlock.fields.SOURCE.value).toBe('costume');
            expect(vm.refreshWorkspace).not.toHaveBeenCalled();
        } finally {
            global.document = originalDocument;
        }
    });

    test('imports pasted files without opening the system file picker', async () => {
        const pastedFile = {name: 'pasted-image.png'};
        const liveBlock = {id: 'draw-block', setDrawAsset_: jest.fn()};
        const workspace = {getBlockById: jest.fn(() => null)};
        const ScratchBlocks = {
            getMainWorkspace: jest.fn(() => ({getBlockById: jest.fn(() => liveBlock)}))
        };
        const block = {
            getFieldValue: jest.fn(name => (name === 'ASSET' ? 'costume:old' : 'costume')),
            id: 'draw-block',
            workspace
        };
        const manager = {
            importFiles: jest.fn(() => Promise.resolve([{name: 'pasted-image', source: 'costume'}]))
        };
        const vm = {
            editingTarget: {id: 'sprite'},
            runtime: {movieAssetManager: manager}
        };

        openImportPicker(vm, block, ScratchBlocks, [pastedFile]);
        await Promise.resolve();
        await Promise.resolve();

        expect(manager.importFiles).toHaveBeenCalledWith('sprite', [pastedFile], {modelName: ''});
        expect(liveBlock.setDrawAsset_).toHaveBeenCalledWith('costume', 'pasted-image');
    });

    test('encodes the combined draw asset selection while keeping legacy source fields readable', () => {
        expect(decodeDrawAsset(encodeDrawAsset('model', 'Hero:Idle'), 'costume')).toEqual({
            asset: 'Hero:Idle',
            source: 'model'
        });
        expect(decodeDrawAsset('legacy-costume', 'costume')).toEqual({
            asset: 'legacy-costume',
            source: 'costume'
        });
    });

    test('switches video controls between silent sequence frames and timed playback', () => {
        const target = {id: 'sprite'};
        const models = [
            {animationCount: 0, motions: [], name: 'Still'},
            {animationCount: 1, motions: [{frameCount: 48, name: 'Walk'}], name: 'Animated'}
        ];
        const vm = {
            editingTarget: target,
            runtime: {movieAssetManager: {getModels: jest.fn(() => models)}}
        };

        expect(drawSelectionUsesFrame(vm, 'video', 'clip')).toBe(true);
        expect(drawSelectionUsesFrame(vm, 'video', 'clip', 'video')).toBe(false);
        expect(drawSelectionUsesFrame(vm, COSTUME_GROUP_SOURCE, 'poses')).toBe(true);
        expect(drawSelectionUsesFrame(vm, 'model', 'Still')).toBe(false);
        expect(drawSelectionUsesFrame(vm, 'model', 'Animated')).toBe(true);
        expect(drawSelectionUsesFrame(vm, 'costume', 'image')).toBe(false);
        expect(getDrawInputVisibility(vm, 'video', 'clip', 'sequence')).toEqual({
            frame: true,
            speed: false,
            text: false,
            videoMode: true,
            volume: false
        });
        expect(getDrawInputVisibility(vm, 'video', 'clip', 'video')).toEqual({
            frame: false,
            speed: true,
            text: false,
            videoMode: true,
            volume: true
        });
        expect(getDrawInputVisibility(vm, COSTUME_GROUP_SOURCE, 'poses')).toEqual({
            frame: true,
            speed: false,
            text: false,
            videoMode: false,
            volume: false
        });
        expect(normalizeVideoMode('anything else')).toBe('sequence');
        expect(modelHasFrames({animationCount: 1})).toBe(true);
    });

    test('keeps draw self-contained while adding reusable composition structures and reporters', () => {
        const vm = {runtime: {}};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const info = blocks.getInfo();

        expect(info.name).toBe('Objects');
        expect(info.blocks.find(blockInfo => blockInfo.opcode === 'draw').text).toBe('draw [ASSET]');

        expect(info.blocks.map(blockInfo => blockInfo.opcode)).toEqual([
            'draw', 'shape', 'arc', 'circularSegment', 'line', 'grouping', 'scene',
            'group', 'simulation', 'transform', 'composite', 'matte', 'renderPass', 'drawPass', 'clearPass',
            'repeat', 'timeOffset',
            'timeRange', 'timeScale', 'timeLoop', 'timeFreeze', 'timeReverse', 'timeRemap',
            'timelineTime', 'keyframeTime', 'leftKeyframeTime',
            'animate', 'loopValue', 'pingPongValue', 'wiggle',
            'timeWithin', 'posterizeTime', 'interpolateColor', 'interpolateAngle', 'interpolateVector',
            'pass', 'numberCurve', 'colorCurve', 'angleCurve', 'stepCurve', 'instanceId', 'instanceSeed'
        ]);
        expect(Object.keys(info.blocks[0].arguments)).toEqual([
            'SOURCE', 'ASSET', 'TEXT', 'VIDEO_MODE', 'FRAME', 'SPEED', 'VOLUME',
            'PX', 'PY', 'PZ',
            'RX', 'RY', 'RZ',
            'SX', 'SY', 'SZ',
            'SIZE', 'WIDTH', 'HEIGHT',
            'T1', 'T2'
        ]);

        const JapaneseObjectBlocks = createObjectBlocksClass({
            getLocale: () => 'ja',
            runtime: {}
        });
        const japaneseInfo = new JapaneseObjectBlocks().getInfo();
        expect(japaneseInfo.name).toBe('レイヤー');
        expect(japaneseInfo.blocks.find(blockInfo => blockInfo.opcode === 'draw').text)
            .toBe('描画 [ASSET]');
        expect(Object.keys(info.blocks[1].arguments)).toEqual([
            'SHAPE', 'N',
            'RATIO',
            'PX', 'PY', 'PZ',
            'RX', 'RY', 'RZ',
            'SX', 'SY', 'SZ',
            'INNER', 'OUTER', 'WIDTH', 'HEIGHT',
            'COLOR', 'OPACITY',
            'T1', 'T2'
        ]);
        expect(info.menus.shapeType.items).toEqual(['polygon', 'star', 'curved star', 'flower']);
        expect(info.blocks[1].arguments.RATIO.defaultValue).toBe(0.5);
        expect(info.blocks[1].text).toContain('ratio: [RATIO]');
        expect(info.menus.blendMode.items).toEqual(BLEND_MODES);
        expect(info.menus.easing.items).toEqual(ANIMATION_EASING_TYPES);
        expect(info.menus.matteMode.items).toEqual(MATTE_MODES);
        expect(info.menus.pathComponent.items).toEqual(['x', 'y']);
        expect(info.blocks[1].text).toContain('time: [T1] ~ [T2] color: [COLOR] opacity: [OPACITY] %');
        expect(info.blocks[1].text).not.toContain('\n');
        expect(info.blocks[0].arguments.T2.defaultValue).toBe(Infinity);
        expect(info.blocks[1].arguments.T2.defaultValue).toBe(Infinity);
        expect(info.blocks[2].arguments).toEqual(expect.objectContaining({
            START: {type: ArgumentType.NUMBER, defaultValue: 0},
            END: {type: ArgumentType.NUMBER, defaultValue: 360},
            T1: {type: expect.anything(), defaultValue: 0},
            T2: {type: expect.anything(), defaultValue: Infinity}
        }));
        expect(info.blocks[3].arguments).toEqual(expect.objectContaining({
            START: {type: ArgumentType.NUMBER, defaultValue: 0},
            END: {type: ArgumentType.NUMBER, defaultValue: 360}
        }));
    });

    test('composes a group transform around its anchor without mutating the draw configuration', () => {
        const configuration = {
            position: {x: 20, y: 10, z: 0},
            rotation: {x: 1, y: 2, z: 3},
            scale: {x: 2, y: 3, z: 4}
        };
        const transformed = applyObjectTransforms(configuration, [{
            anchor: {x: 10, y: 10, z: 0},
            position: {x: 100, y: 50, z: 0},
            rotation: {x: 0, y: 0, z: 90},
            scale: {x: 2, y: 2, z: 1}
        }]);

        expect(transformed.position.x).toBeCloseTo(100);
        expect(transformed.position.y).toBeCloseTo(70);
        expect(transformed.position.z).toBeCloseTo(0);
        expect(transformed.rotation).toEqual({x: 1, y: 2, z: 93});
        expect(transformed.scale).toEqual({x: 4, y: 6, z: 4});
        expect(configuration.position).toEqual({x: 20, y: 10, z: 0});
    });

    test('evaluates animation reporters from the deterministic timeline time', () => {
        const runtime = {movieAssetManager: {
            getKeyframeTime: id => Number(id) * 2,
            getLeftKeyframeTime: (first, second) => Math.min(Number(first), Number(second)) * 2,
            timeline: {currentTime: 1}
        }};
        const ObjectBlocks = createObjectBlocksClass({runtime});
        const blocks = new ObjectBlocks();
        const util = makeUtil();

        expect(blocks.timelineTime({}, util)).toBe(1);
        expect(blocks.keyframeTime({ID: 1.5}, util)).toBe(3);
        expect(blocks.leftKeyframeTime({FIRST: 3, SECOND: 1.5}, util)).toBe(3);
        expect(blocks.animate({A: 0, B: 100, T1: 0, T2: 2, EASING: 'Linear'}, util)).toBe(50);
        expect(blocks.loopValue({A: 0, B: 100, DURATION: 2}, util)).toBe(50);
        expect(blocks.pingPongValue({A: 0, B: 100, DURATION: 2}, util)).toBe(100);
        expect(blocks.timeWithin({T1: 0.5, T2: 1.5}, util)).toBe(true);
        expect(blocks.posterizeTime({FPS: 4}, util)).toBe(1);
        expect(blocks.interpolateColor({
            A: '#000000', B: '#ffffff', T1: 0, T2: 2, EASING: 'Linear'
        }, util)).toBe('#808080');
        expect(blocks.interpolateAngle({
            A: 350, B: 10, T1: 0, T2: 2, EASING: 'Linear'
        }, util)).toBe(360);
        expect(blocks.interpolateVector({
            COMPONENT: 'y', X1: 0, Y1: 20, Z1: 0, X2: 100, Y2: 40, Z2: 100,
            T1: 0, T2: 2, EASING: 'Linear'
        }, util)).toBe(30);
        expect(blocks.pass({
            POINTS: '0 0 100 0 100 100', COMPONENT: 'x', TIME: 0.5
        }, util)).toBe(50);
        expect(blocks.wiggle({FREQUENCY: 2, AMOUNT: 20, SEED: 1}, util)).toBe(
            blocks.wiggle({FREQUENCY: 2, AMOUNT: 20, SEED: 1}, util)
        );
    });

    test('applies transform C-block context to every child draw without yielding', () => {
        const blocksContainer = {
            getBranch: jest.fn((blockId, branch) => (
                blockId === 'transform' && branch === 1 ? 'transform-branch' : null
            ))
        };
        const target = {id: 'sprite', blocks: blocksContainer};
        const manager = {drawObject: jest.fn(), runWithoutWaiting: jest.fn()};
        let objectBlocks;
        const runtime = {
            movieAssetManager: manager,
            sequencer: {
                activeThread: null,
                stepThread: jest.fn(thread => {
                    objectBlocks.draw({
                        ASSET: 'costume:Logo', SOURCE: 'costume', PX: 20, PY: 10, PZ: 0,
                        RX: 0, RY: 0, RZ: 5, SX: 1, SY: 1, SZ: 1,
                        SIZE: 100, WIDTH: 100, HEIGHT: 100, T1: 0, T2: 1
                    }, {target, thread});
                })
            }
        };
        const ObjectBlocks = createObjectBlocksClass({runtime});
        objectBlocks = new ObjectBlocks();
        const util = {
            target,
            thread: {
                blockContainer: blocksContainer,
                peekStack: jest.fn(() => 'transform'),
                target
            }
        };

        expect(objectBlocks.transform({
            PX: 100, PY: 50, PZ: 0,
            AX: 10, AY: 10, AZ: 0,
            RX: 0, RY: 0, RZ: 90,
            SX: 2, SY: 2, SZ: 1
        }, util)).toBeUndefined();
        expect(manager.drawObject).toHaveBeenCalledWith(target, expect.objectContaining({
            position: expect.objectContaining({x: expect.closeTo(100), y: expect.closeTo(70), z: 0}),
            rotation: {x: 0, y: 0, z: 95},
            scale: {x: 2, y: 2, z: 1}
        }));
        expect(util.thread).not.toHaveProperty('objectTransformStack');
    });

    test('records a Transform node and keeps child Draw coordinates local until renderer execution', () => {
        const blocksContainer = {
            getBranch: jest.fn((blockId, branch) => (
                blockId === 'transform' && branch === 1 ? 'transform-branch' : null
            ))
        };
        const target = {id: 'sprite', blocks: blocksContainer};
        const frameGraph = new MovieFrameGraphRenderer({}, jest.fn());
        const parents = [];
        const manager = {
            createFrameGraphNode: (type, properties, parent) => frameGraph.append(
                type,
                properties,
                parent || parents[parents.length - 1]
            ),
            drawObject: (drawTarget, configuration, parent) => frameGraph.append(
                FRAME_GRAPH_NODE_TYPES.DRAW,
                {configuration, drawKind: 'object', target: drawTarget},
                parent || parents[parents.length - 1]
            ),
            isCollectingFrameGraph: () => frameGraph.collecting,
            runWithoutWaiting: jest.fn(),
            withFrameGraphParent: (parent, callback) => {
                parents.push(parent);
                try {
                    return callback();
                } finally {
                    parents.pop();
                }
            }
        };
        let objectBlocks;
        const runtime = {
            movieAssetManager: manager,
            sequencer: {
                activeThread: null,
                stepThread: jest.fn(thread => {
                    objectBlocks.draw({
                        ASSET: 'costume:Logo', SOURCE: 'costume', PX: 20, PY: 10, PZ: 0,
                        RX: 0, RY: 0, RZ: 5, SX: 1, SY: 1, SZ: 1,
                        SIZE: 100, WIDTH: 100, HEIGHT: 100, T1: 0, T2: 1
                    }, {target, thread});
                })
            }
        };
        const ObjectBlocks = createObjectBlocksClass({runtime});
        objectBlocks = new ObjectBlocks();
        const util = {
            target,
            thread: {
                blockContainer: blocksContainer,
                peekStack: jest.fn(() => 'transform'),
                target
            }
        };
        frameGraph.beginFrame();

        expect(objectBlocks.transform({
            PX: 100, PY: 50, PZ: 0,
            AX: 10, AY: 10, AZ: 0,
            RX: 0, RY: 0, RZ: 90,
            SX: 2, SY: 2, SZ: 1
        }, util)).toBeUndefined();

        const transformNode = frameGraph.currentFrame.children[0];
        expect(transformNode.type).toBe(FRAME_GRAPH_NODE_TYPES.TRANSFORM);
        expect(transformNode.children).toHaveLength(1);
        expect(transformNode.children[0]).toEqual(expect.objectContaining({
            configuration: expect.objectContaining({
                position: {x: 20, y: 10, z: 0},
                rotation: {x: 0, y: 0, z: 5},
                scale: {x: 1, y: 1, z: 1}
            }),
            type: FRAME_GRAPH_NODE_TYPES.DRAW
        }));
    });

    test('repeat creates rotated, time-shifted component instances in the same VM tick', () => {
        const blocksContainer = {
            getBranch: jest.fn((blockId, branch) => (
                blockId === 'repeat' && branch === 1 ? 'repeat-branch' : null
            ))
        };
        const target = {id: 'sprite', blocks: blocksContainer};
        const manager = {drawObject: jest.fn(), runWithoutWaiting: jest.fn()};
        let objectBlocks;
        const runtime = {
            movieAssetManager: manager,
            sequencer: {
                activeThread: null,
                stepThread: jest.fn(thread => {
                    objectBlocks.draw({
                        ASSET: 'costume:Dot', SOURCE: 'costume', PX: 10, PY: 0, PZ: 0,
                        RX: 0, RY: 0, RZ: 0, SX: 1, SY: 1, SZ: 1,
                        SIZE: 100, WIDTH: 100, HEIGHT: 100, T1: 0, T2: 1
                    }, {target, thread});
                })
            }
        };
        const ObjectBlocks = createObjectBlocksClass({runtime});
        objectBlocks = new ObjectBlocks();
        const util = {
            target,
            thread: {
                blockContainer: blocksContainer,
                peekStack: jest.fn(() => 'repeat'),
                target
            }
        };

        expect(objectBlocks.repeat({COUNT: 3, ANGLE: 90, TIME: 0.5}, util)).toBeUndefined();
        const configurations = manager.drawObject.mock.calls.map(call => call[1]);
        expect(configurations).toHaveLength(3);
        expect(configurations[0]).toEqual(expect.objectContaining({
            position: {x: 10, y: 0, z: 0},
            time: {start: 0, end: 1}
        }));
        expect(configurations[1].position.x).toBeCloseTo(0);
        expect(configurations[1].position.y).toBeCloseTo(10);
        expect(configurations[1].time).toEqual({start: 0.5, end: 1.5});
        expect(configurations[2].time).toEqual({start: 1, end: 2});
        expect(new Set(configurations.map(configuration => configuration.playbackId)).size).toBe(3);
    });

    test('evaluates a time-scale branch at local time without yielding', () => {
        const blocksContainer = {
            getBranch: jest.fn((blockId, branch) => (
                blockId === 'scale' && branch === 1 ? 'scale-branch' : null
            ))
        };
        const target = {id: 'sprite', blocks: blocksContainer};
        const manager = {
            drawObject: jest.fn(),
            runWithoutWaiting: jest.fn(),
            timeline: {currentTime: 4}
        };
        let objectBlocks;
        const runtime = {
            movieAssetManager: manager,
            sequencer: {
                activeThread: null,
                stepThread: jest.fn(thread => {
                    expect(objectBlocks.timelineTime({}, {target, thread})).toBe(2);
                    objectBlocks.draw({
                        ASSET: 'costume:Logo', SOURCE: 'costume', PX: 0, PY: 0, PZ: 0,
                        RX: 0, RY: 0, RZ: 0, SX: 1, SY: 1, SZ: 1,
                        SIZE: 100, WIDTH: 100, HEIGHT: 100, T1: 1, T2: 3
                    }, {target, thread});
                })
            }
        };
        const ObjectBlocks = createObjectBlocksClass({runtime});
        objectBlocks = new ObjectBlocks();
        const util = {
            target,
            thread: {
                blockContainer: blocksContainer,
                peekStack: jest.fn(() => 'scale'),
                target
            }
        };

        expect(objectBlocks.timeScale({SCALE: 0.5}, util)).toBeUndefined();
        expect(manager.drawObject).toHaveBeenCalledWith(target, expect.objectContaining({
            evaluationTime: 2,
            time: {start: 1, end: 3}
        }));
    });

    test('composite closes an asynchronous isolated group with opacity and blend settings without yielding', async () => {
        let resolveDraw;
        const pendingDraw = new Promise(resolve => {
            resolveDraw = resolve;
        });
        const blocksContainer = {
            getBranch: jest.fn((blockId, branch) => (
                blockId === 'composite' && branch === 1 ? 'composite-branch' : null
            ))
        };
        const target = {id: 'sprite', blocks: blocksContainer};
        const manager = {runWithoutWaiting: jest.fn()};
        const penFX = {beginGroup: jest.fn(), endGroup: jest.fn()};
        const runtime = {
            movieAssetManager: manager,
            penFX,
            sequencer: {
                activeThread: null,
                stepThread: jest.fn(thread => {
                    thread.objectPendingDraws = [pendingDraw];
                })
            }
        };
        const ObjectBlocks = createObjectBlocksClass({runtime});
        const objectBlocks = new ObjectBlocks();
        const util = {
            target,
            thread: {
                blockContainer: blocksContainer,
                peekStack: jest.fn(() => 'composite'),
                target
            }
        };

        expect(objectBlocks.composite({OPACITY: 80, BLEND: 'screen'}, util)).toBeUndefined();
        expect(penFX.beginGroup).toHaveBeenCalledTimes(1);
        expect(penFX.endGroup).not.toHaveBeenCalled();
        const completion = manager.runWithoutWaiting.mock.calls[0][0];
        resolveDraw();
        await completion;
        expect(penFX.endGroup).toHaveBeenCalledWith({blendMode: 'screen', opacity: 0.8});
    });

    test('matte evaluates source then mask and composites only after both asynchronous branches finish', async () => {
        let resolveSource;
        let resolveMask;
        const sourceDraw = new Promise(resolve => {
            resolveSource = resolve;
        });
        const maskDraw = new Promise(resolve => {
            resolveMask = resolve;
        });
        const events = [];
        const blocksContainer = {
            getBranch: jest.fn((blockId, branch) => (
                blockId === 'matte' ? `matte-branch-${branch}` : null
            ))
        };
        const target = {id: 'sprite', blocks: blocksContainer};
        const manager = {runWithoutWaiting: jest.fn()};
        const penFX = {
            beginMatte: jest.fn(() => events.push('begin source')),
            beginMatteMask: jest.fn(() => events.push('begin mask')),
            endMatte: jest.fn(() => events.push('end matte'))
        };
        const runtime = {
            movieAssetManager: manager,
            penFX,
            sequencer: {
                activeThread: null,
                stepThread: jest.fn(thread => {
                    events.push(thread.topBlock);
                    thread.objectPendingDraws = [
                        thread.topBlock === 'matte-branch-1' ? sourceDraw : maskDraw
                    ];
                })
            }
        };
        const ObjectBlocks = createObjectBlocksClass({runtime});
        const objectBlocks = new ObjectBlocks();
        const util = {
            target,
            thread: {
                blockContainer: blocksContainer,
                peekStack: jest.fn(() => 'matte'),
                target
            }
        };

        expect(objectBlocks.matte({MODE: 'luma inverted'}, util)).toBeUndefined();
        expect(events).toEqual(['begin source', 'matte-branch-1']);
        const completion = manager.runWithoutWaiting.mock.calls[0][0];
        resolveSource();
        await Promise.resolve();
        await Promise.resolve();
        expect(events).toEqual(['begin source', 'matte-branch-1', 'begin mask', 'matte-branch-2']);
        resolveMask();
        await completion;
        expect(events).toEqual([
            'begin source', 'matte-branch-1', 'begin mask', 'matte-branch-2', 'end matte'
        ]);
        expect(penFX.endMatte).toHaveBeenCalledWith({mode: 'luma inverted'});
    });

    test('every new Objects command primitive returns undefined', () => {
        const runtime = {sequencer: {stepThread: jest.fn()}};
        const ObjectBlocks = createObjectBlocksClass({runtime});
        const blocks = new ObjectBlocks();
        const util = makeUtil();
        util.thread.blockContainer = {getBranch: jest.fn(() => null)};
        util.thread.target = util.target;

        expect(blocks.group({}, util)).toBeUndefined();
        expect(blocks.simulation({}, util)).toBeUndefined();
        expect(blocks.transform({}, util)).toBeUndefined();
        expect(blocks.composite({}, util)).toBeUndefined();
        expect(blocks.matte({}, util)).toBeUndefined();
        expect(blocks.renderPass({}, util)).toBeUndefined();
        expect(blocks.drawPass({}, util)).toBeUndefined();
        expect(blocks.clearPass({}, util)).toBeUndefined();
        expect(blocks.repeat({COUNT: 2}, util)).toBeUndefined();
        expect(blocks.timeOffset({}, util)).toBeUndefined();
        expect(blocks.timeRange({START: 0, END: 2}, util)).toBeUndefined();
        expect(blocks.timeScale({}, util)).toBeUndefined();
        expect(blocks.timeLoop({}, util)).toBeUndefined();
        expect(blocks.timeFreeze({}, util)).toBeUndefined();
        expect(blocks.timeReverse({}, util)).toBeUndefined();
        expect(blocks.timeRemap({}, util)).toBeUndefined();
    });

    test.each([
        ['arc', {
            INNER: 25, OUTER: 50, START: 10, END: 120,
            PX: 10, PY: 20, PZ: 30, RX: 1, RY: 2, RZ: 3, SX: 2, SY: 3, SZ: 4,
            WIDTH: 120, HEIGHT: 80
        }],
        ['circularSegment', {
            OUTER: 50, START: 10, END: 120,
            PX: 10, PY: 20, PZ: 30, RX: 1, RY: 2, RZ: 3, SX: 2, SY: 3, SZ: 4,
            WIDTH: 120, HEIGHT: 80
        }],
        ['line', {
            P1X: 10, P1Y: 20, P1Z: 30, P2X: 40, P2Y: 50, P2Z: 60, THICKNESS: 4
        }]
    ])('draws the %s shape without returning asynchronous work', (opcode, args) => {
        const pending = new Promise(() => {});
        const manager = {drawShape: jest.fn(() => pending), runWithoutWaiting: jest.fn()};
        const ObjectBlocks = createObjectBlocksClass({runtime: {movieAssetManager: manager}});
        const blocks = new ObjectBlocks();
        const util = makeUtil();

        expect(blocks[opcode](Object.assign({
            COLOR: '#ff0000', OPACITY: 65, T1: 0, T2: Infinity
        }, args), util)).toBeUndefined();
        expect(manager.drawShape).toHaveBeenCalledWith(util.target, expect.objectContaining({
            shape: opcode === 'circularSegment' ? 'circular segment' : opcode
        }));
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(pending);
    });

    test('draws a generated shape without returning asynchronous work to the VM', () => {
        const pending = new Promise(() => {});
        const manager = {
            drawShape: jest.fn(() => pending),
            runWithoutWaiting: jest.fn()
        };
        const vm = {runtime: {movieAssetManager: manager}};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = makeUtil();

        expect(blocks.shape({
            HEIGHT: 80,
            INNER: 25,
            N: 5,
            OUTER: 50,
            PX: 10,
            PY: 20,
            PZ: 30,
            RX: 1,
            RY: 2,
            RZ: 3,
            SHAPE: 'star',
            RATIO: 0.35,
            SX: 2,
            SY: 3,
            SZ: 4,
            T1: 1,
            T2: 4,
            WIDTH: 120,
            COLOR: '#ff0000',
            OPACITY: 65
        }, util)).toBeUndefined();

        expect(manager.drawShape).toHaveBeenCalledWith(util.target, {
            height: 80,
            n: 5,
            ratio: 0.35,
            playbackId: 'draw-block',
            position: {x: 10, y: 20, z: 30},
            radius: {inner: 25, outer: 50},
            rotation: {x: 1, y: 2, z: 3},
            scale: {x: 2, y: 3, z: 4},
            shape: 'star',
            time: {start: 1, end: 4},
            width: 120,
            color: '#ff0000',
            opacity: 65
        });
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(pending);
    });

    test('draws one complete object and never returns a promise to the VM', () => {
        const pending = new Promise(() => {});
        const manager = {
            drawObject: jest.fn(() => pending),
            runWithoutWaiting: jest.fn()
        };
        const vm = {runtime: {movieAssetManager: manager}};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = makeUtil();

        expect(blocks.draw({
            SOURCE: 'text',
            ASSET: 'Movie Sans',
            TEXT: 'Title',
            VIDEO_MODE: 'sequence',
            FRAME: 12,
            SPEED: 1,
            VOLUME: 100,
            PX: 10,
            PY: 20,
            PZ: 30,
            RX: 1,
            RY: 2,
            RZ: 3,
            SX: 2,
            SY: 3,
            SZ: 4,
            SIZE: 75,
            WIDTH: 125,
            HEIGHT: 80,
            T1: 1.5,
            T2: 4.5
        }, util)).toBeUndefined();

        expect(manager.drawObject).toHaveBeenCalledWith(util.target, {
            asset: 'Movie Sans',
            frame: 12,
            height: 80,
            playbackId: 'draw-block',
            position: {x: 10, y: 20, z: 30},
            rotation: {x: 1, y: 2, z: 3},
            scale: {x: 2, y: 3, z: 4},
            size: 75,
            source: 'text',
            speed: 1,
            text: 'Title',
            time: {start: 1.5, end: 4.5},
            videoMode: 'sequence',
            volume: 100,
            width: 125
        });
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(pending);
        expect(util.startBranch).not.toHaveBeenCalled();
    });

    test('starts asynchronous Objects video playback without returning a promise to the VM', () => {
        const pending = new Promise(() => {});
        const manager = {
            drawObject: jest.fn(() => pending),
            runWithoutWaiting: jest.fn()
        };
        const vm = {runtime: {movieAssetManager: manager}};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = makeUtil();

        expect(blocks.draw({
            ASSET: 'video:clip',
            FRAME: 1,
            HEIGHT: 100,
            PX: 0,
            PY: 0,
            PZ: 480,
            RX: 0,
            RY: 0,
            RZ: 0,
            SIZE: 100,
            SOURCE: 'video',
            SPEED: 2,
            SX: 1,
            SY: 1,
            SZ: 1,
            T1: 3,
            T2: 8,
            TEXT: '',
            VIDEO_MODE: 'video',
            VOLUME: 60,
            WIDTH: 100
        }, util)).toBeUndefined();

        expect(manager.drawObject).toHaveBeenCalledWith(util.target, expect.objectContaining({
            asset: 'clip',
            playbackId: 'draw-block',
            speed: 2,
            videoMode: 'video',
            volume: 60
        }));
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(pending);
    });

    test('runs both grouping branches atomically on the current thread', () => {
        const penFX = {beginGroup: jest.fn(), endGroup: jest.fn()};
        const harness = makeGroupingHarness();
        harness.runtime.penFX = penFX;
        const vm = {runtime: harness.runtime};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = harness.util;

        expect(blocks.grouping({}, util)).toBeUndefined();
        expect(penFX.beginGroup).toHaveBeenCalledTimes(1);
        expect(penFX.endGroup).not.toHaveBeenCalled();
        expect(util.startBranch).toHaveBeenNthCalledWith(1, 1, true, true);
        expect(harness.sequencer.stepThread).not.toHaveBeenCalled();

        blocks.grouping({}, util);
        expect(util.startBranch).toHaveBeenNthCalledWith(2, 2, true, true);

        blocks.grouping({}, util);
        expect(penFX.endGroup).toHaveBeenCalledTimes(1);
        expect(harness.sequencer.activeThread).toBe(harness.originalActiveThread);
    });

    test('keeps an inline grouping under one frame graph node', () => {
        const frameGraph = new MovieFrameGraphRenderer({}, jest.fn());
        const manager = {
            frameGraphCollectionParents: [],
            createFrameGraphNode: (type, properties, parent) => frameGraph.append(type, properties, parent),
            drawObject: (target, configuration, parent) => frameGraph.append(
                FRAME_GRAPH_NODE_TYPES.DRAW,
                {configuration, drawKind: 'object', target},
                parent
            ),
            isCollectingFrameGraph: () => frameGraph.collecting,
            runWithoutWaiting: jest.fn()
        };
        const penFX = {
            beginEffectCapture: jest.fn(),
            endEffectCapture: jest.fn(() => [])
        };
        const target = {id: 'sprite', blocks: {}};
        const thread = {peekStack: jest.fn(() => 'grouping'), target};
        const util = {
            stackFrame: {},
            startBranch: jest.fn(),
            target,
            thread
        };
        const runtime = {movieAssetManager: manager, penFX};
        const ObjectBlocks = createObjectBlocksClass({runtime});
        const objectBlocks = new ObjectBlocks();
        frameGraph.beginFrame();

        objectBlocks.grouping({}, util);
        objectBlocks.draw({ASSET: 'costume:Logo', SOURCE: 'costume'}, util);
        objectBlocks.grouping({}, util);
        objectBlocks.grouping({}, util);

        const groupingNode = frameGraph.currentFrame.children[0];
        expect(groupingNode.type).toBe(FRAME_GRAPH_NODE_TYPES.COMPOSITE);
        expect(groupingNode.children).toHaveLength(1);
        expect(groupingNode.children[0].type).toBe(FRAME_GRAPH_NODE_TYPES.DRAW);
        expect(manager.frameGraphCollectionParents).toHaveLength(0);
        expect(thread).not.toHaveProperty('objectFrameGraphParent');
    });

    test('runs a scene branch atomically and queues one z-buffer render without returning a promise', () => {
        const pending = new Promise(() => {});
        const capture = {entries: [], targetId: 'sprite'};
        let sceneThread;
        const blocksContainer = {
            getBranch: jest.fn((blockId, branch) => blockId === 'scene' && branch === 1 ? 'scene-branch' : null)
        };
        const target = {id: 'sprite', blocks: blocksContainer};
        const manager = {
            createObjectSceneCapture: jest.fn(() => capture),
            renderObjectScene: jest.fn(() => pending),
            runWithoutWaiting: jest.fn()
        };
        const runtime = {
            movieAssetManager: manager,
            sequencer: {
                activeThread: {id: 'parent'},
                stepThread: jest.fn(thread => {
                    sceneThread = thread;
                })
            }
        };
        const ObjectBlocks = createObjectBlocksClass({runtime});
        const objectBlocks = new ObjectBlocks();
        const util = {
            stackFrame: {},
            startBranch: jest.fn(),
            target,
            thread: {
                blockContainer: blocksContainer,
                peekStack: jest.fn(() => 'scene'),
                target
            }
        };

        expect(objectBlocks.scene({}, util)).toBeUndefined();
        expect(sceneThread.objectSceneCapture).toBe(capture);
        expect(sceneThread.peekStackFrame().warpMode).toBe(true);
        expect(manager.renderObjectScene).toHaveBeenCalledWith(target, capture);
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(pending);
        expect(util.startBranch).not.toHaveBeenCalled();
    });

    test('passes the active scene capture to draw without returning asynchronous work', () => {
        const capture = {entries: [], targetId: 'sprite'};
        const manager = {drawObject: jest.fn(), runWithoutWaiting: jest.fn()};
        const ObjectBlocks = createObjectBlocksClass({runtime: {movieAssetManager: manager}});
        const objectBlocks = new ObjectBlocks();
        const util = makeUtil();
        util.thread.objectSceneCapture = capture;

        expect(objectBlocks.draw({
            ASSET: 'costume:image', SOURCE: 'costume', PX: 0, PY: 0, PZ: 480,
            RX: 0, RY: 0, RZ: 0, SX: 1, SY: 1, SZ: 1, SIZE: 100,
            WIDTH: 100, HEIGHT: 100, T1: 0, T2: Infinity
        }, util)).toBeUndefined();
        expect(manager.drawObject).toHaveBeenCalledWith(util.target, expect.objectContaining({
            sceneCapture: capture
        }));
    });

    test('passes the active scene capture to a shape without returning asynchronous work', () => {
        const capture = {entries: [], targetId: 'sprite'};
        const manager = {drawShape: jest.fn(), runWithoutWaiting: jest.fn()};
        const ObjectBlocks = createObjectBlocksClass({runtime: {movieAssetManager: manager}});
        const objectBlocks = new ObjectBlocks();
        const util = makeUtil();
        util.thread.objectSceneCapture = capture;

        expect(objectBlocks.shape({
            COLOR: '#ff0000', HEIGHT: 80, INNER: 25, N: 5, OPACITY: 100, OUTER: 50,
            PX: 0, PY: 0, PZ: 480, RX: 0, RY: 0, RZ: 0, SHAPE: 'star',
            SX: 1, SY: 1, SZ: 1, T1: 0, T2: Infinity, WIDTH: 120
        }, util)).toBeUndefined();
        expect(manager.drawShape).toHaveBeenCalledWith(util.target, expect.objectContaining({
            sceneCapture: capture
        }));
    });

    test('sets line dimensions to 100 instead of reusing a previous shape size', () => {
        const manager = {drawShape: jest.fn(), runWithoutWaiting: jest.fn()};
        const ObjectBlocks = createObjectBlocksClass({runtime: {movieAssetManager: manager}});
        const objectBlocks = new ObjectBlocks();
        const util = makeUtil();

        expect(objectBlocks.line({
            COLOR: '#ffffff',
            OPACITY: 100,
            P1X: 0,
            P1Y: 0,
            P1Z: 480,
            P2X: 100,
            P2Y: 100,
            P2Z: 480,
            T1: 0,
            T2: Infinity,
            THICKNESS: 5
        }, util)).toBeUndefined();
        expect(manager.drawShape).toHaveBeenCalledWith(util.target, expect.objectContaining({
            height: 100,
            shape: 'line',
            width: 100
        }));
    });

    test('stack-clicks an Objects reporter without compiling it as an invalid command block', () => {
        const vm = new VM();
        installObjectBlocks(vm);
        const runtime = vm.runtime;
        const sprite = new Sprite(null, runtime);
        sprite.name = 'main';
        const target = new RenderedTarget(sprite, runtime);
        runtime.targets = [target];
        target.blocks.createBlock({
            id: 'animate',
            opcode: 'objects_animate',
            inputs: {},
            fields: {},
            next: null,
            parent: null,
            shadow: false,
            topLevel: true
        });
        const emitCompileError = jest.spyOn(runtime, 'emitCompileError');

        const thread = runtime._pushThread('animate', target, {stackClick: true});

        expect(thread.isCompiled).toBe(false);
        expect(emitCompileError).not.toHaveBeenCalled();
        expect(runtime.compilerOptions.enabled).toBe(true);

        // Flyout templates use the opcode itself as the click ID and are not stored in target.blocks.
        const flyoutThread = runtime._pushThread('objects_animate', target, {stackClick: true});
        expect(flyoutThread.isCompiled).toBe(false);
        expect(emitCompileError).not.toHaveBeenCalled();
        expect(runtime.compilerOptions.enabled).toBe(true);
    });

    test('finishes a scene branch and the following block in one compiled VM step', () => {
        const vm = new VM();
        installObjectBlocks(vm);
        const runtime = vm.runtime;
        const stageSprite = new Sprite(null, runtime);
        stageSprite.name = 'Stage';
        const stage = new RenderedTarget(stageSprite, runtime);
        stage.isStage = true;
        const sprite = new Sprite(null, runtime);
        sprite.name = 'Sprite';
        const target = new RenderedTarget(sprite, runtime);
        runtime.targets = [stage, target];
        const capture = {entries: [], targetId: target.id};
        runtime.movieAssetManager = {
            createObjectSceneCapture: jest.fn(() => capture),
            renderObjectScene: jest.fn(),
            runWithoutWaiting: jest.fn()
        };

        target.blocks.createBlock({
            id: 'scene',
            opcode: 'objects_scene',
            inputs: {
                SUBSTACK: {name: 'SUBSTACK', block: 'scene-branch', shadow: null}
            },
            fields: {},
            next: 'after-scene',
            parent: null,
            shadow: false,
            topLevel: true
        });
        for (const [id, parent] of [
            ['scene-branch', 'scene'],
            ['after-scene', 'scene']
        ]) {
            target.blocks.createBlock({
                id,
                opcode: 'control_incr_counter',
                inputs: {},
                fields: {},
                next: null,
                parent,
                shadow: false,
                topLevel: false
            });
        }

        runtime.ext_scratch3_control.clearCounter();
        const thread = runtime._pushThread('scene', target);
        expect(thread.isCompiled).toBe(true);
        runtime.sequencer.stepThread(thread);

        expect(runtime.ext_scratch3_control.getCounter()).toBe(2);
        expect(runtime.movieAssetManager.renderObjectScene).toHaveBeenCalledWith(target, capture);
    });

    test('finishes grouping and the following block in one compiled VM step', () => {
        const vm = new VM();
        installObjectBlocks(vm);
        const runtime = vm.runtime;
        const stageSprite = new Sprite(null, runtime);
        stageSprite.name = 'Stage';
        const stage = new RenderedTarget(stageSprite, runtime);
        stage.isStage = true;
        const sprite = new Sprite(null, runtime);
        sprite.name = 'Sprite';
        const target = new RenderedTarget(sprite, runtime);
        runtime.targets = [stage, target];
        const groupBoundaries = [];
        runtime.penFX = {
            beginGroup: jest.fn(() => groupBoundaries.push(['begin', runtime.ext_scratch3_control.getCounter()])),
            endGroup: jest.fn(() => groupBoundaries.push(['end', runtime.ext_scratch3_control.getCounter()]))
        };

        target.blocks.createBlock({
            id: 'grouping',
            opcode: 'objects_grouping',
            inputs: {
                SUBSTACK: {name: 'SUBSTACK', block: 'objects-branch', shadow: null},
                SUBSTACK2: {name: 'SUBSTACK2', block: 'effects-branch', shadow: null}
            },
            fields: {},
            next: 'after-grouping',
            parent: null,
            shadow: false,
            topLevel: true
        });
        for (const [id, parent] of [
            ['objects-branch', 'grouping'],
            ['effects-branch', 'grouping'],
            ['after-grouping', 'grouping']
        ]) {
            target.blocks.createBlock({
                id,
                opcode: 'control_incr_counter',
                inputs: {},
                fields: {},
                next: null,
                parent,
                shadow: false,
                topLevel: false
            });
        }

        runtime.ext_scratch3_control.clearCounter();
        const thread = runtime._pushThread('grouping', target);
        expect(thread.isCompiled).toBe(true);
        runtime.sequencer.stepThread(thread);

        expect(runtime.ext_scratch3_control.getCounter()).toBe(3);
        expect(groupBoundaries).toEqual([['begin', 0], ['end', 2]]);
        expect(runtime.penFX.beginGroup).toHaveBeenCalledTimes(1);
        expect(runtime.penFX.endGroup).toHaveBeenCalledTimes(1);
    });

    test('finishes grouping and the following block in one interpreter VM step', () => {
        const vm = new VM();
        installObjectBlocks(vm);
        const runtime = vm.runtime;
        runtime.compilerOptions.enabled = false;
        const stageSprite = new Sprite(null, runtime);
        stageSprite.name = 'Stage';
        const stage = new RenderedTarget(stageSprite, runtime);
        stage.isStage = true;
        const sprite = new Sprite(null, runtime);
        sprite.name = 'Sprite';
        const target = new RenderedTarget(sprite, runtime);
        runtime.targets = [stage, target];
        const groupBoundaries = [];
        runtime.penFX = {
            beginGroup: jest.fn(() => groupBoundaries.push(['begin', runtime.ext_scratch3_control.getCounter()])),
            endGroup: jest.fn(() => groupBoundaries.push(['end', runtime.ext_scratch3_control.getCounter()]))
        };

        target.blocks.createBlock({
            id: 'grouping',
            opcode: 'objects_grouping',
            inputs: {
                SUBSTACK: {name: 'SUBSTACK', block: 'objects-branch', shadow: null},
                SUBSTACK2: {name: 'SUBSTACK2', block: 'effects-branch', shadow: null}
            },
            fields: {},
            next: 'after-grouping',
            parent: null,
            shadow: false,
            topLevel: true
        });
        for (const [id, parent] of [
            ['objects-branch', 'grouping'],
            ['effects-branch', 'grouping'],
            ['after-grouping', 'grouping']
        ]) {
            target.blocks.createBlock({
                id,
                opcode: 'control_incr_counter',
                inputs: {},
                fields: {},
                next: null,
                parent,
                shadow: false,
                topLevel: false
            });
        }

        runtime.ext_scratch3_control.clearCounter();
        const thread = runtime._pushThread('grouping', target);
        expect(thread.isCompiled).toBe(false);
        runtime.sequencer.stepThread(thread);

        expect(runtime.ext_scratch3_control.getCounter()).toBe(3);
        expect(groupBoundaries).toEqual([['begin', 0], ['end', 2]]);
    });

    test('preserves custom procedure arguments for draws inside a grouping', () => {
        const vm = new VM();
        installObjectBlocks(vm);
        const runtime = vm.runtime;
        const stageSprite = new Sprite(null, runtime);
        stageSprite.name = 'Stage';
        const stage = new RenderedTarget(stageSprite, runtime);
        stage.isStage = true;
        const sprite = new Sprite(null, runtime);
        sprite.name = 'Sprite';
        const target = new RenderedTarget(sprite, runtime);
        runtime.targets = [stage, target];
        const drawObject = jest.fn();
        runtime.movieAssetManager = {drawObject, runWithoutWaiting: jest.fn()};

        const createBlock = (id, opcode, properties = {}) => target.blocks.createBlock({
            fields: {},
            id,
            inputs: {},
            next: null,
            parent: null,
            shadow: false,
            topLevel: false,
            opcode,
            ...properties
        });
        createBlock('definition', 'procedures_definition', {
            inputs: {custom_block: {block: 'prototype'}},
            next: 'grouping',
            topLevel: true
        });
        createBlock('prototype', 'procedures_prototype', {
            mutation: {
                argumentdefaults: '[0]',
                argumentids: '["x"]',
                argumentnames: '["x"]',
                proccode: 'paint %s'
            },
            parent: 'definition'
        });
        createBlock('grouping', 'objects_grouping', {
            inputs: {
                SUBSTACK: {name: 'SUBSTACK', block: 'draw', shadow: null},
                SUBSTACK2: {name: 'SUBSTACK2', block: null, shadow: null}
            },
            parent: 'definition'
        });
        createBlock('draw', 'objects_draw', {
            inputs: {PX: {name: 'PX', block: 'argument', shadow: null}},
            parent: 'grouping'
        });
        createBlock('argument', 'argument_reporter_string_number', {
            fields: {VALUE: {name: 'VALUE', value: 'x'}},
            parent: 'draw'
        });
        createBlock('call', 'procedures_call', {
            inputs: {x: {name: 'x', block: 'value', shadow: null}},
            mutation: {argumentids: '["x"]', proccode: 'paint %s'},
            topLevel: true
        });
        createBlock('value', 'text', {
            fields: {TEXT: {name: 'TEXT', value: '10'}},
            parent: 'call'
        });

        const thread = runtime._pushThread('call', target);
        runtime.sequencer.stepThread(thread);

        expect(drawObject).toHaveBeenCalledWith(target, expect.objectContaining({
            position: expect.objectContaining({x: 10})
        }));
    });

    test('preserves custom procedure arguments through nested groupings', () => {
        const vm = new VM();
        installObjectBlocks(vm);
        const runtime = vm.runtime;
        const stageSprite = new Sprite(null, runtime);
        stageSprite.name = 'Stage';
        const stage = new RenderedTarget(stageSprite, runtime);
        stage.isStage = true;
        const sprite = new Sprite(null, runtime);
        sprite.name = 'Sprite';
        const target = new RenderedTarget(sprite, runtime);
        runtime.targets = [stage, target];
        const drawObject = jest.fn();
        runtime.movieAssetManager = {drawObject, runWithoutWaiting: jest.fn()};

        const createBlock = (id, opcode, properties = {}) => target.blocks.createBlock({
            fields: {},
            id,
            inputs: {},
            next: null,
            parent: null,
            shadow: false,
            topLevel: false,
            opcode,
            ...properties
        });
        createBlock('definition', 'procedures_definition', {
            inputs: {custom_block: {block: 'prototype'}},
            next: 'outer'
        });
        createBlock('prototype', 'procedures_prototype', {
            mutation: {
                argumentdefaults: '[0]',
                argumentids: '["x"]',
                argumentnames: '["x"]',
                proccode: 'paint %s'
            },
            parent: 'definition'
        });
        createBlock('outer', 'objects_grouping', {
            inputs: {
                SUBSTACK: {name: 'SUBSTACK', block: 'inner', shadow: null},
                SUBSTACK2: {name: 'SUBSTACK2', block: null, shadow: null}
            },
            parent: 'definition'
        });
        createBlock('inner', 'objects_grouping', {
            inputs: {
                SUBSTACK: {name: 'SUBSTACK', block: 'draw', shadow: null},
                SUBSTACK2: {name: 'SUBSTACK2', block: null, shadow: null}
            },
            parent: 'outer'
        });
        createBlock('draw', 'objects_draw', {
            inputs: {PX: {name: 'PX', block: 'argument', shadow: null}},
            parent: 'inner'
        });
        createBlock('argument', 'argument_reporter_string_number', {
            fields: {VALUE: {name: 'VALUE', value: 'x'}},
            parent: 'draw'
        });
        createBlock('call', 'procedures_call', {
            inputs: {x: {name: 'x', block: 'value', shadow: null}},
            mutation: {argumentids: '["x"]', proccode: 'paint %s'},
            topLevel: true
        });
        createBlock('value', 'text', {
            fields: {TEXT: {name: 'TEXT', value: '10'}},
            parent: 'call'
        });

        const thread = runtime._pushThread('call', target);
        runtime.sequencer.stepThread(thread);

        expect(drawObject).toHaveBeenCalledWith(target, expect.objectContaining({
            position: expect.objectContaining({x: 10})
        }));
    });

    test('preserves custom procedure arguments for every object shape in a grouping', () => {
        const vm = new VM();
        installObjectBlocks(vm);
        const runtime = vm.runtime;
        const stageSprite = new Sprite(null, runtime);
        stageSprite.name = 'Stage';
        const stage = new RenderedTarget(stageSprite, runtime);
        stage.isStage = true;
        const sprite = new Sprite(null, runtime);
        sprite.name = 'Sprite';
        const target = new RenderedTarget(sprite, runtime);
        runtime.targets = [stage, target];
        const drawObject = jest.fn();
        const drawShape = jest.fn();
        runtime.movieAssetManager = {drawObject, drawShape, runWithoutWaiting: jest.fn()};

        const createBlock = (id, opcode, properties = {}) => target.blocks.createBlock({
            fields: {},
            id,
            inputs: {},
            next: null,
            parent: null,
            shadow: false,
            topLevel: false,
            opcode,
            ...properties
        });
        createBlock('definition', 'procedures_definition', {
            inputs: {custom_block: {block: 'prototype'}},
            next: 'grouping',
            topLevel: true
        });
        createBlock('prototype', 'procedures_prototype', {
            mutation: {
                argumentdefaults: '[0]',
                argumentids: '["y"]',
                argumentnames: '["y"]',
                proccode: 'paint %s'
            },
            parent: 'definition'
        });
        createBlock('grouping', 'objects_grouping', {
            inputs: {
                SUBSTACK: {name: 'SUBSTACK', block: 'draw', shadow: null},
                SUBSTACK2: {name: 'SUBSTACK2', block: null, shadow: null}
            },
            parent: 'definition'
        });
        createBlock('draw', 'objects_draw', {
            inputs: {PY: {name: 'PY', block: 'draw-argument', shadow: null}},
            next: 'shape',
            parent: 'grouping'
        });
        createBlock('shape', 'objects_shape', {
            inputs: {PY: {name: 'PY', block: 'shape-argument', shadow: null}},
            next: 'arc',
            parent: 'draw'
        });
        createBlock('arc', 'objects_arc', {
            inputs: {PY: {name: 'PY', block: 'arc-argument', shadow: null}},
            next: 'segment',
            parent: 'shape'
        });
        createBlock('segment', 'objects_circularSegment', {
            inputs: {PY: {name: 'PY', block: 'segment-argument', shadow: null}},
            next: 'line',
            parent: 'arc'
        });
        createBlock('line', 'objects_line', {
            inputs: {
                P1Y: {name: 'P1Y', block: 'line-argument', shadow: null},
                P2Y: {name: 'P2Y', block: 'line-argument2', shadow: null}
            },
            parent: 'segment'
        });
        for (const [id, parent] of [
            ['draw-argument', 'draw'],
            ['shape-argument', 'shape'],
            ['arc-argument', 'arc'],
            ['segment-argument', 'segment'],
            ['line-argument', 'line'],
            ['line-argument2', 'line']
        ]) {
            createBlock(id, 'argument_reporter_string_number', {
                fields: {VALUE: {name: 'VALUE', value: 'y'}},
                parent
            });
        }
        createBlock('call', 'procedures_call', {
            inputs: {y: {name: 'y', block: 'value', shadow: null}},
            mutation: {argumentids: '["y"]', proccode: 'paint %s'},
            topLevel: true
        });
        createBlock('value', 'text', {
            fields: {TEXT: {name: 'TEXT', value: '10'}},
            parent: 'call'
        });

        const thread = runtime._pushThread('call', target);
        runtime.sequencer.stepThread(thread);

        expect(drawObject).toHaveBeenCalledWith(target, expect.objectContaining({
            position: expect.objectContaining({y: 10})
        }));
        expect(drawShape).toHaveBeenNthCalledWith(1, target, expect.objectContaining({
            position: expect.objectContaining({y: 10})
        }));
        expect(drawShape).toHaveBeenNthCalledWith(2, target, expect.objectContaining({
            position: expect.objectContaining({y: 10})
        }));
        expect(drawShape).toHaveBeenNthCalledWith(3, target, expect.objectContaining({
            position: expect.objectContaining({y: 10})
        }));
        expect(drawShape).toHaveBeenNthCalledWith(4, target, expect.objectContaining({
            position1: expect.objectContaining({y: 10}),
            position2: expect.objectContaining({y: 10})
        }));
    });

    test('finishes an asynchronous grouped draw before applying captured effects', async () => {
        let resolveDraw;
        const pendingDraw = new Promise(resolve => {
            resolveDraw = resolve;
        });
        const effects = [{}];
        const penFX = {
            applyCapturedEffects: jest.fn(),
            beginEffectCapture: jest.fn(),
            beginGroup: jest.fn(),
            endEffectCapture: jest.fn(() => effects),
            endGroup: jest.fn()
        };
        const manager = {
            drawObject: jest.fn(() => pendingDraw),
            runWithoutWaiting: jest.fn()
        };
        const harness = makeGroupingHarness(thread => {
            if (thread.topBlock === 'objects-branch') thread.objectPendingDraws = [pendingDraw];
        });
        Object.assign(harness.runtime, {movieAssetManager: manager, penFX});
        const vm = {runtime: harness.runtime};
        const ObjectBlocks = createObjectBlocksClass(vm);
        const blocks = new ObjectBlocks();
        const util = harness.util;

        expect(blocks.grouping({}, util)).toBeUndefined();
        blocks.draw({ASSET: 'video:clip', SOURCE: 'video'}, util);
        blocks.grouping({}, util);
        blocks.grouping({}, util);
        expect(penFX.beginEffectCapture).toHaveBeenCalledTimes(1);
        expect(penFX.applyCapturedEffects).not.toHaveBeenCalled();
        expect(harness.sequencer.stepThread).not.toHaveBeenCalled();
        const finishGroup = manager.runWithoutWaiting.mock.calls[1][0];
        resolveDraw();
        await finishGroup;
        expect(penFX.applyCapturedEffects).toHaveBeenCalledWith(effects);
        expect(penFX.endGroup).toHaveBeenCalledTimes(1);
        expect(manager.runWithoutWaiting).toHaveBeenCalledWith(expect.any(Promise));
    });

    test('keeps nested inline groupings in one thread until every asynchronous draw finishes', async () => {
        let resolveVideo;
        const pendingVideo = new Promise(resolve => {
            resolveVideo = resolve;
        });
        const effects = [{callback: jest.fn()}];
        const manager = {
            drawObject: jest.fn(() => pendingVideo),
            runWithoutWaiting: jest.fn()
        };
        const penFX = {
            applyCapturedEffects: jest.fn(),
            beginEffectCapture: jest.fn(),
            beginGroup: jest.fn(),
            endEffectCapture: jest.fn(() => effects),
            endGroup: jest.fn()
        };
        const blocksContainer = {};
        const target = {id: 'sprite', blocks: blocksContainer};
        const thread = {
            blockContainer: blocksContainer,
            peekStack: jest.fn(() => 'outer'),
            target
        };
        const outerFrame = {};
        const innerFrame = {};
        const util = {
            stackFrame: outerFrame,
            startBranch: jest.fn(),
            target,
            thread
        };
        const runtime = {movieAssetManager: manager, penFX, sequencer: {stepThread: jest.fn()}};
        const ObjectBlocks = createObjectBlocksClass({runtime});
        const objectBlocks = new ObjectBlocks();

        objectBlocks.grouping({}, util);
        util.stackFrame = innerFrame;
        thread.peekStack.mockReturnValue('inner');
        objectBlocks.grouping({}, util);
        objectBlocks.draw({ASSET: 'video:clip', SOURCE: 'video'}, util);
        objectBlocks.grouping({}, util);
        objectBlocks.grouping({}, util);

        util.stackFrame = outerFrame;
        thread.peekStack.mockReturnValue('outer');
        objectBlocks.grouping({}, util);
        objectBlocks.grouping({}, util);

        expect(runtime.sequencer.stepThread).not.toHaveBeenCalled();
        expect(util.startBranch.mock.calls).toEqual([
            [1, true, true],
            [1, true, true],
            [2, true, true],
            [2, true, true]
        ]);
        expect(manager.runWithoutWaiting).toHaveBeenCalledTimes(3);
        expect(penFX.endGroup).not.toHaveBeenCalled();

        resolveVideo();
        await Promise.all(manager.runWithoutWaiting.mock.calls.slice(1).map(call => call[0]));

        expect(penFX.applyCapturedEffects).toHaveBeenCalledTimes(2);
        expect(penFX.endGroup).toHaveBeenCalledTimes(2);
    });

    test('keeps an outer grouping open for an asynchronous video draw in a nested grouping', async () => {
        let resolveVideo;
        const pendingVideo = new Promise(resolve => {
            resolveVideo = resolve;
        });
        const events = [];
        const blocksContainer = {
            getBranch: jest.fn((blockId, branch) => {
                const branches = {
                    outer: ['outer-objects', 'outer-effects'],
                    inner: ['inner-objects', 'inner-effects']
                };
                const branchIds = branches[blockId];
                return branchIds ? branchIds[branch - 1] : null;
            })
        };
        const target = {id: 'sprite', blocks: blocksContainer};
        const parentThread = {
            blockContainer: blocksContainer,
            peekStack: jest.fn(() => 'outer'),
            target
        };
        const manager = {
            drawObject: jest.fn(() => pendingVideo),
            runWithoutWaiting: jest.fn()
        };
        const penFX = {
            applyCapturedEffects: jest.fn(() => events.push('apply effects')),
            beginEffectCapture: jest.fn(() => events.push('begin effects')),
            beginGroup: jest.fn(() => events.push('begin group')),
            endEffectCapture: jest.fn(() => [{}]),
            endGroup: jest.fn(() => events.push('end group'))
        };
        const sequencer = {
            activeThread: null,
            stepThread: jest.fn(thread => {
                events.push(thread.topBlock);
                if (thread.topBlock === 'outer-objects') {
                    const originalPeekStack = thread.peekStack;
                    thread.peekStack = jest.fn(() => 'inner');
                    blocks.grouping({}, {
                        target,
                        thread
                    });
                    thread.peekStack = originalPeekStack;
                }
                if (thread.topBlock === 'inner-objects') {
                    blocks.draw({ASSET: 'video:clip', SOURCE: 'video'}, {
                        target,
                        thread
                    });
                }
            })
        };
        const runtime = {movieAssetManager: manager, penFX, sequencer};
        const ObjectBlocks = createObjectBlocksClass({runtime});
        const blocks = new ObjectBlocks();
        const util = {
            target,
            thread: parentThread
        };

        expect(blocks.grouping({}, util)).toBeUndefined();
        expect(manager.drawObject).toHaveBeenCalledWith(target, expect.objectContaining({source: 'video'}));
        expect(events).toEqual([
            'begin group',
            'outer-objects',
            'begin group',
            'inner-objects',
            'begin effects',
            'inner-effects',
            'begin effects',
            'outer-effects'
        ]);

        resolveVideo();
        await Promise.all(manager.runWithoutWaiting.mock.calls.map(call => call[0]));

        expect(events).toEqual([
            'begin group',
            'outer-objects',
            'begin group',
            'inner-objects',
            'begin effects',
            'inner-effects',
            'begin effects',
            'outer-effects',
            'apply effects',
            'end group',
            'apply effects',
            'end group'
        ]);
    });

    test('finishes an asynchronous group before starting the next group', async () => {
        let resolveFirstDraw;
        const firstDraw = new Promise(resolve => {
            resolveFirstDraw = resolve;
        });
        const events = [];
        const blocksContainer = {
            getBranch: jest.fn((blockId, branch) => `${blockId}-branch-${branch}`)
        };
        const target = {id: 'sprite', blocks: blocksContainer};
        const sequencer = {
            activeThread: null,
            stepThread: jest.fn(thread => {
                events.push(thread.topBlock);
                if (thread.topBlock === 'first-branch-1') thread.objectPendingDraws = [firstDraw];
            })
        };
        const penFX = {
            applyCapturedEffects: jest.fn(() => events.push('apply first effects')),
            beginEffectCapture: jest.fn(),
            beginGroup: jest.fn(() => events.push('begin group')),
            endEffectCapture: jest.fn(() => [{}]),
            endGroup: jest.fn(() => events.push('end group'))
        };
        const manager = {runWithoutWaiting: jest.fn()};
        const runtime = {movieAssetManager: manager, penFX, sequencer};
        const ObjectBlocks = createObjectBlocksClass({runtime});
        const objectBlocks = new ObjectBlocks();
        const makeGroupingUtil = blockId => ({
            target,
            thread: {
                blockContainer: blocksContainer,
                peekStack: jest.fn(() => blockId),
                target
            }
        });

        expect(objectBlocks.grouping({}, makeGroupingUtil('first'))).toBeUndefined();
        expect(objectBlocks.grouping({}, makeGroupingUtil('second'))).toBeUndefined();
        expect(events).toEqual([
            'begin group',
            'first-branch-1',
            'first-branch-2'
        ]);

        const secondGroup = manager.runWithoutWaiting.mock.calls[1][0];
        resolveFirstDraw();
        await secondGroup;

        expect(events).toEqual([
            'begin group',
            'first-branch-1',
            'first-branch-2',
            'apply first effects',
            'end group',
            'begin group',
            'second-branch-1',
            'second-branch-2',
            'end group'
        ]);
        expect(penFX.beginGroup).toHaveBeenCalledTimes(2);
        expect(penFX.endGroup).toHaveBeenCalledTimes(2);
    });

    test('does not let a stopped asynchronous group affect the next timeline frame', async () => {
        let resolveFirstDraw;
        const firstDraw = new Promise(resolve => {
            resolveFirstDraw = resolve;
        });
        const events = [];
        const blocksContainer = {
            getBranch: jest.fn((blockId, branch) => `${blockId}-branch-${branch}`)
        };
        const target = {id: 'sprite', blocks: blocksContainer};
        const sequencer = {
            activeThread: null,
            stepThread: jest.fn(thread => {
                events.push(thread.topBlock);
                if (thread.topBlock === 'first-branch-1') thread.objectPendingDraws = [firstDraw];
            })
        };
        const penFX = {
            applyCapturedEffects: jest.fn(() => events.push('apply effects')),
            beginEffectCapture: jest.fn(),
            beginGroup: jest.fn(() => events.push('begin group')),
            cancelGroups: jest.fn(() => events.push('cancel groups')),
            endEffectCapture: jest.fn(() => [{}]),
            endGroup: jest.fn(() => events.push('end group'))
        };
        const manager = {runWithoutWaiting: jest.fn()};
        const runtime = {movieAssetManager: manager, penFX, sequencer, on: jest.fn()};
        const ObjectBlocks = createObjectBlocksClass({runtime});
        const objectBlocks = new ObjectBlocks();
        const makeGroupingUtil = blockId => ({
            target,
            thread: {
                blockContainer: blocksContainer,
                peekStack: jest.fn(() => blockId),
                target
            }
        });

        objectBlocks.grouping({}, makeGroupingUtil('first'));
        const stopAll = runtime.on.mock.calls.find(call => call[0] === 'PROJECT_STOP_ALL')[1];
        stopAll();
        objectBlocks.grouping({}, makeGroupingUtil('second'));

        expect(events).toEqual([
            'begin group',
            'first-branch-1',
            'first-branch-2',
            'cancel groups',
            'begin group',
            'second-branch-1',
            'second-branch-2',
            'end group'
        ]);

        resolveFirstDraw();
        await manager.runWithoutWaiting.mock.calls[0][0];

        expect(penFX.applyCapturedEffects).not.toHaveBeenCalled();
        expect(penFX.endGroup).toHaveBeenCalledTimes(1);
    });
});
