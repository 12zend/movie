import LazyScratchBlocks from './tw-lazy-scratch-blocks';
import installBlockNumberScrubbing from './block-number-scrubbing';
import installObjectBlockDefinitions from './object-blocks-ui';
import installPenFXBlockDefinitions from './pen-fx-ui';
import installListBlocks from './list-blocks';
import {localize} from './movie-block-l10n';

/**
 * Connect scratch blocks with the vm
 * @param {VirtualMachine} vm - The scratch vm
 * @param {?string} locale - The active UI locale
 * @return {ScratchBlocks} ScratchBlocks connected with the vm
 */
export default function (vm, locale = 'en') {
    const ScratchBlocks = LazyScratchBlocks.get();
    const translate = (english, japanese) => localize(locale, english, japanese);
    installListBlocks(vm, ScratchBlocks);
    installObjectBlockDefinitions(ScratchBlocks, vm, locale);
    installPenFXBlockDefinitions(ScratchBlocks, locale);
    installBlockNumberScrubbing(ScratchBlocks, () => {
        const manager = vm.runtime && vm.runtime.movieAssetManager;
        if (manager && typeof manager.requestTimelinePreviewRefresh === 'function') {
            manager.requestTimelinePreviewRefresh();
        }
    });
    const jsonForMenuBlock = function (name, menuOptionsFn, colors, start) {
        return {
            message0: '%1',
            args0: [
                {
                    type: 'field_dropdown',
                    name: name,
                    options: function () {
                        return start.concat(menuOptionsFn());
                    }
                }
            ],
            inputsInline: true,
            output: 'String',
            colour: colors.secondary,
            colourSecondary: colors.secondary,
            colourTertiary: colors.tertiary,
            colourQuaternary: colors.quaternary,
            outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND
        };
    };

    const jsonForHatBlockMenu = function (hatName, name, menuOptionsFn, colors, start) {
        return {
            message0: hatName,
            args0: [
                {
                    type: 'field_dropdown',
                    name: name,
                    options: function () {
                        return start.concat(menuOptionsFn());
                    }
                }
            ],
            colour: colors.primary,
            colourSecondary: colors.secondary,
            colourTertiary: colors.tertiary,
            colourQuaternary: colors.quaternary,
            extensions: ['shape_hat']
        };
    };


    const jsonForSensingMenus = function (menuOptionsFn) {
        return {
            message0: ScratchBlocks.Msg.SENSING_OF,
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PROPERTY',
                    options: function () {
                        return menuOptionsFn();
                    }

                },
                {
                    type: 'input_value',
                    name: 'OBJECT'
                }
            ],
            output: true,
            colour: ScratchBlocks.Colours.sensing.primary,
            colourSecondary: ScratchBlocks.Colours.sensing.secondary,
            colourTertiary: ScratchBlocks.Colours.sensing.tertiary,
            colourQuaternary: ScratchBlocks.Colours.sensing.quaternary,
            outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND
        };
    };

    const soundsMenu = function () {
        let menu = [['', '']];
        if (vm.editingTarget && vm.editingTarget.sprite.sounds.length > 0) {
            menu = vm.editingTarget.sprite.sounds.map(sound => [sound.name, sound.name]);
        }
        menu.push([
            ScratchBlocks.ScratchMsgs.translate('SOUND_IMPORT', 'import...'),
            ScratchBlocks.importSoundCallback
        ]);
        return menu;
    };

    // Kept for the hidden legacy MP4 export block so older projects remain editable.
    const renderingSoundsMenu = function () {
        if (vm.editingTarget && vm.editingTarget.sprite.sounds.length > 0) {
            return vm.editingTarget.sprite.sounds.map(sound => [sound.name, sound.name]);
        }
        return [['', '']];
    };

    const costumesMenu = function () {
        if (vm.editingTarget && vm.editingTarget.getCostumes().length > 0) {
            return vm.editingTarget.getCostumes().map(costume => [costume.name, costume.name]);
        }
        return [['', '']];
    };

    const videosMenu = function () {
        const manager = vm.runtime.movieAssetManager;
        const videos = manager && vm.editingTarget ? manager.getVideos(vm.editingTarget) : [];
        return videos.length ? videos.map(video => [video.name, video.name]) : [['', '']];
    };

    const modelsMenu = function () {
        const manager = vm.runtime.movieAssetManager;
        const models = manager && vm.editingTarget ? manager.getModels(vm.editingTarget) : [];
        return models.length ? models.map(model => [model.name, model.name]) : [['', '']];
    };

    const fontsMenu = function () {
        const defaults = [
            ['Sans Serif', 'sans-serif'],
            ['Serif', 'serif'],
            ['Monospace', 'monospace']
        ];
        const fonts = vm.runtime.fontManager.getFonts().map(font => [font.name, font.name]);
        return defaults.concat(fonts);
    };

    const backdropsMenu = function () {
        const next = ScratchBlocks.ScratchMsgs.translate('LOOKS_NEXTBACKDROP', 'next backdrop');
        const previous = ScratchBlocks.ScratchMsgs.translate('LOOKS_PREVIOUSBACKDROP', 'previous backdrop');
        const random = ScratchBlocks.ScratchMsgs.translate('LOOKS_RANDOMBACKDROP', 'random backdrop');
        if (vm.runtime.targets[0] && vm.runtime.targets[0].getCostumes().length > 0) {
            return vm.runtime.targets[0].getCostumes().map(costume => [costume.name, costume.name])
                .concat([[next, 'next backdrop'],
                    [previous, 'previous backdrop'],
                    [random, 'random backdrop']]);
        }
        return [['', '']];
    };

    const backdropNamesMenu = function () {
        const stage = vm.runtime.getTargetForStage();
        if (stage && stage.getCostumes().length > 0) {
            return stage.getCostumes().map(costume => [costume.name, costume.name]);
        }
        return [['', '']];
    };

    const spriteMenu = function () {
        const sprites = [];
        for (const targetId in vm.runtime.targets) {
            if (!Object.prototype.hasOwnProperty.call(vm.runtime.targets, targetId)) continue;
            if (vm.runtime.targets[targetId].isOriginal) {
                if (!vm.runtime.targets[targetId].isStage) {
                    if (vm.runtime.targets[targetId] === vm.editingTarget) {
                        continue;
                    }
                    sprites.push([vm.runtime.targets[targetId].sprite.name, vm.runtime.targets[targetId].sprite.name]);
                }
            }
        }
        return sprites;
    };

    const cloneMenu = function () {
        if (vm.editingTarget && vm.editingTarget.isStage) {
            const menu = spriteMenu();
            if (menu.length === 0) {
                return [['', '']]; // Empty menu matches Scratch 2 behavior
            }
            return menu;
        }
        const myself = ScratchBlocks.ScratchMsgs.translate('CONTROL_CREATECLONEOF_MYSELF', 'myself');
        return [[myself, '_myself_']].concat(spriteMenu());
    };

    const soundColors = ScratchBlocks.Colours.sounds;

    const looksColors = ScratchBlocks.Colours.looks;

    const motionColors = ScratchBlocks.Colours.motion;

    const sensingColors = ScratchBlocks.Colours.sensing;

    const controlColors = ScratchBlocks.Colours.control;

    const eventColors = ScratchBlocks.Colours.event;

    ScratchBlocks.Blocks.event_initialize = {
        init: function () {
            this.jsonInit({
                message0: translate('initialize', '初期化する'),
                category: ScratchBlocks.Categories.event,
                extensions: ['colours_event', 'shape_hat']
            });
        }
    };

    ScratchBlocks.Blocks.event_renderframe = {
        init: function () {
            this.jsonInit({
                message0: translate('render frame', 'フレームを描画する'),
                category: ScratchBlocks.Categories.event,
                extensions: ['colours_event', 'shape_hat']
            });
        }
    };

    ScratchBlocks.Blocks.sensing_settimeroffsetto = {
        init: function () {
            this.jsonInit({
                message0: 'set timer offset to %1',
                args0: [{type: 'input_value', name: 'OFFSET'}],
                category: ScratchBlocks.Categories.sensing,
                extensions: ['colours_sensing', 'shape_statement']
            });
        }
    };

    ScratchBlocks.Blocks.sound_playatframe = {
        init: function () {
            this.jsonInit({
                message0: 'play sound at %1 frame: %2',
                args0: [
                    {type: 'input_value', name: 'SOUND_MENU'},
                    {type: 'input_value', name: 'FRAME'}
                ],
                inputsInline: true,
                category: ScratchBlocks.Categories.sound,
                extensions: ['colours_sounds', 'shape_statement']
            });
        }
    };

    ScratchBlocks.Blocks.sound_playattime = {
        init: function () {
            this.jsonInit({
                message0: translate(
                    'play sound at %1 time: %2 ~ %3 speed: %4 volume: %5',
                    '音声 %1 を %2 から %3 まで %4 倍速で %5 の音量で鳴らす'
                ),
                args0: [
                    {type: 'input_value', name: 'SOUND_MENU'},
                    {type: 'input_value', name: 'T1'},
                    {type: 'input_value', name: 'T2'},
                    {type: 'input_value', name: 'SPEED'},
                    {type: 'input_value', name: 'VOLUME'}
                ],
                inputsInline: true,
                category: ScratchBlocks.Categories.sound,
                extensions: ['colours_sounds', 'shape_statement']
            });
        }
    };

    const motionStatement = (message0, args0, inputsInline = true) => ({
        message0,
        args0,
        inputsInline,
        category: ScratchBlocks.Categories.motion,
        extensions: ['colours_motion', 'shape_statement']
    });

    const motionReporter = message0 => ({
        message0,
        category: ScratchBlocks.Categories.motion,
        extensions: ['colours_motion', 'output_number']
    });

    const operatorReporter = (message0, args0) => ({
        message0,
        args0,
        inputsInline: true,
        category: ScratchBlocks.Categories.operators,
        extensions: ['colours_operators', 'output_number']
    });

    const numberInput = name => ({type: 'input_value', name});
    const rotationOrderOptions = [
        ['XYZ', 'XYZ'], ['XZY', 'XZY'], ['YXZ', 'YXZ'],
        ['YZX', 'YZX'], ['ZXY', 'ZXY'], ['ZYX', 'ZYX']
    ];

    const easingTypeOptions = [
        'PowerIn',
        'PowerOut',
        'PowerInOut',
        'CircIn',
        'CircOut',
        'CircInOut',
        'ExpoIn',
        'ExpoOut',
        'ExpoInOut'
    ].map(type => [type, type]);
    const easingType2Options = [
        ['Elastic', 'Elastic'],
        ['Bounce', 'Bounce']
    ];

    ScratchBlocks.Blocks.operator_easing = {
        init: function () {
            this.jsonInit(operatorReporter(
                'easing type: %1 %2 value: %3 ~ %4 time: %5 ~ %6 power: %7 speed: %8 strength: %9',
                [
                    {type: 'field_dropdown', name: 'TYPE', options: easingTypeOptions},
                    {type: 'field_dropdown', name: 'TYPE2', options: easingType2Options},
                    numberInput('V0'),
                    numberInput('V1'),
                    numberInput('T0'),
                    numberInput('T1'),
                    numberInput('POWER'),
                    numberInput('SPEED'),
                    numberInput('STRENGTH')
                ]
            ));
        }
    };

    ScratchBlocks.Blocks.motion_gotoxyz = {
        init: function () {
            this.jsonInit(motionStatement(translate('go to x: %1 y: %2 z: %3', 'x: %1 y: %2 z: %3 に移動する'), [
                numberInput('X'), numberInput('Y'), numberInput('Z')
            ]));
        }
    };

    ScratchBlocks.Blocks.motion_gotoxyz_nocamera = {
        init: function () {
            this.jsonInit(motionStatement(
                translate('go to (not camera) x: %1 y: %2 z: %3', '(カメラを除く) x: %1 y: %2 z: %3 に移動する'),
                [
                    numberInput('X'), numberInput('Y'), numberInput('Z')
                ]
            ));
        }
    };

    ScratchBlocks.Blocks.motion_setrotation = {
        init: function () {
            this.jsonInit(motionStatement(translate(
                'set rotation x: %1 y: %2 z: %3', '向きを x: %1 y: %2 z: %3 にする'
            ), [
                numberInput('X'), numberInput('Y'), numberInput('Z')
            ]));
        }
    };

    ScratchBlocks.Blocks.motion_setscale = {
        init: function () {
            this.jsonInit(motionStatement(translate(
                'set scale to x: %1 y: %2 z: %3', '大きさを x: %1 y: %2 z: %3 にする'
            ), [
                numberInput('X'), numberInput('Y'), numberInput('Z')
            ]));
        }
    };

    ScratchBlocks.Blocks.motion_changerotationby = {
        init: function () {
            this.jsonInit(motionStatement(translate(
                'change rotation by x: %1 y: %2 z: %3', '向きを x: %1 y: %2 z: %3 ずつ変える'
            ), [
                numberInput('X'), numberInput('Y'), numberInput('Z')
            ]));
        }
    };

    ScratchBlocks.Blocks.motion_setrotationorder = {
        init: function () {
            this.jsonInit(motionStatement(translate('set rotation order to %1', '回転順を %1 にする'), [{
                type: 'field_dropdown', name: 'ORDER', options: rotationOrderOptions
            }]));
        }
    };

    ScratchBlocks.Blocks.motion_changezby = {
        init: function () {
            this.jsonInit(motionStatement(translate('change z by %1', 'zを %1 ずつ変える'), [numberInput('DZ')]));
        }
    };

    ScratchBlocks.Blocks.motion_setz = {
        init: function () {
            this.jsonInit(motionStatement(translate('set z to %1', 'zを %1 にする'), [numberInput('Z')]));
        }
    };

    ScratchBlocks.Blocks.motion_setcamerato = {
        init: function () {
            this.jsonInit(motionStatement(translate(
                'set camera to x: %1 y: %2 z: %3', 'カメラを x: %1 y: %2 z: %3 にする'
            ), [
                numberInput('X'), numberInput('Y'), numberInput('Z')
            ]));
        }
    };

    const defineCameraAxisBlocks = axis => {
        const upper = axis.toUpperCase();
        ScratchBlocks.Blocks[`motion_setcamera${axis}`] = {
            init: function () {
                this.jsonInit(motionStatement(
                    translate(`set camera ${axis} to %1`, `カメラの${axis}を %1 にする`), [numberInput(upper)]
                ));
            }
        };
        ScratchBlocks.Blocks[`motion_changecamera${axis}by`] = {
            init: function () {
                this.jsonInit(motionStatement(
                    translate(`change camera ${axis} by %1`, `カメラの${axis}を %1 ずつ変える`),
                    [numberInput(upper)]
                ));
            }
        };
    };
    ['x', 'y', 'z'].forEach(defineCameraAxisBlocks);

    ScratchBlocks.Blocks.motion_setcamerarotation = {
        init: function () {
            this.jsonInit(motionStatement(translate(
                'set camera rotation to x: %1 y: %2 z: %3', 'カメラの向きを x: %1 y: %2 z: %3 にする'
            ), [
                numberInput('X'), numberInput('Y'), numberInput('Z')
            ]));
        }
    };

    ScratchBlocks.Blocks.motion_changecamerarotationby = {
        init: function () {
            this.jsonInit(motionStatement(translate(
                'change camera rotation by x: %1 y: %2 z: %3',
                'カメラの向きを x: %1 y: %2 z: %3 ずつ変える'
            ), [
                numberInput('X'), numberInput('Y'), numberInput('Z')
            ]));
        }
    };

    ScratchBlocks.Blocks.motion_setcamerarotationorder = {
        init: function () {
            this.jsonInit(motionStatement(translate(
                'set camera rotation order to %1', 'カメラの回転順を %1 にする'
            ), [{
                type: 'field_dropdown', name: 'ORDER', options: rotationOrderOptions
            }]));
        }
    };

    ScratchBlocks.Blocks.motion_setfov = {
        init: function () {
            this.jsonInit(motionStatement(translate('set FOV to %1', '画角を %1 にする'), [numberInput('FOV')]));
        }
    };

    ScratchBlocks.Blocks.motion_lookat = {
        init: function () {
            this.jsonInit(motionStatement(
                translate(
                    'look at x: %1 y: %2 z: %3 from camera x: %4 y: %5 z: %6',
                    'x: %1 y: %2 z: %3 を カメラ x: %4 y: %5 z: %6 から見る'
                ),
                [
                    numberInput('X'), numberInput('Y'), numberInput('Z'),
                    numberInput('CAMERAX'), numberInput('CAMERAY'), numberInput('CAMERAZ')
                ]
            ));
        }
    };

    const reporterBlocks = {
        motion_zposition: translate('z position', 'z座標'),
        motion_rotationx: translate('rotation x', '向きx'),
        motion_rotationy: translate('rotation y', '向きy'),
        motion_rotationz: translate('rotation z', '向きz'),
        motion_camerax: translate('camera x', 'カメラのx座標'),
        motion_cameray: translate('camera y', 'カメラのy座標'),
        motion_cameraz: translate('camera z', 'カメラのz座標'),
        motion_camerarotationx: translate('camera rotation x', 'カメラの向きx'),
        motion_camerarotationy: translate('camera rotation y', 'カメラの向きy'),
        motion_camerarotationz: translate('camera rotation z', 'カメラの向きz'),
        motion_fov: translate('FOV', '画角'),
        motion_focallength: translate('focal length', '焦点距離')
    };
    Object.keys(reporterBlocks).forEach(opcode => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit(motionReporter(reporterBlocks[opcode]));
            }
        };
    });
    ['motion_rotationorder', 'motion_camerarotationorder'].forEach(opcode => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit({
                    message0: opcode === 'motion_rotationorder' ?
                        translate('rotation order', '回転順') :
                        translate('camera rotation order', 'カメラの回転順'),
                    category: ScratchBlocks.Categories.motion,
                    extensions: ['colours_motion', 'output_string']
                });
            }
        };
    });

    ScratchBlocks.Blocks.sound_sounds_menu.init = function () {
        const json = jsonForMenuBlock('SOUND_MENU', soundsMenu, soundColors, []);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.looks_costume.init = function () {
        const json = jsonForMenuBlock('COSTUME', costumesMenu, looksColors, []);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.looks_video = {
        init: function () {
            const json = jsonForMenuBlock('VIDEO', videosMenu, looksColors, []);
            this.jsonInit(json);
        }
    };

    ScratchBlocks.Blocks.looks_model = {
        init: function () {
            const json = jsonForMenuBlock('MODEL', modelsMenu, looksColors, []);
            this.jsonInit(json);
        }
    };

    ScratchBlocks.Blocks.looks_font = {
        init: function () {
            const json = jsonForMenuBlock('FONT', fontsMenu, looksColors, []);
            this.jsonInit(json);
        }
    };

    ScratchBlocks.Blocks.looks_switchvideoto = {
        init: function () {
            this.jsonInit({
                message0: 'switch video to %1',
                args0: [{type: 'input_value', name: 'VIDEO'}],
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    };

    ScratchBlocks.Blocks.looks_rendervideo = {
        init: function () {
            this.jsonInit({
                message0: 'render video %1 at frame %2',
                args0: [
                    {type: 'input_value', name: 'VIDEO'},
                    {type: 'input_value', name: 'FRAME'}
                ],
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    };

    ScratchBlocks.Blocks.looks_clearscene = {
        init: function () {
            this.jsonInit({
                message0: 'clear scene',
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    };

    ScratchBlocks.Blocks.looks_rendermodel = {
        init: function () {
            this.jsonInit({
                message0: 'render model %1',
                args0: [{type: 'input_value', name: 'MODEL'}],
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    };

    const buildingPrimitiveBlock = type => ({
        init: function () {
            this.jsonInit({
                message0: `render ${type} x: %1 y: %2 z: %3 ~ x: %4 y: %5 z: %6`,
                args0: [
                    {type: 'input_value', name: 'X1'},
                    {type: 'input_value', name: 'Y1'},
                    {type: 'input_value', name: 'Z1'},
                    {type: 'input_value', name: 'X2'},
                    {type: 'input_value', name: 'Y2'},
                    {type: 'input_value', name: 'Z2'}
                ],
                message1: 'uv: u: %1 v: %2 ~ u: %3 v: %4',
                args1: [
                    {type: 'input_value', name: 'U1'},
                    {type: 'input_value', name: 'V1'},
                    {type: 'input_value', name: 'U2'},
                    {type: 'input_value', name: 'V2'}
                ],
                message2: 'material: %1',
                args2: [{type: 'input_value', name: 'MATERIAL'}],
                inputsInline: true,
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    });

    ScratchBlocks.Blocks.looks_renderwall = buildingPrimitiveBlock('wall');
    ScratchBlocks.Blocks.looks_renderfloor = buildingPrimitiveBlock('floor');
    ScratchBlocks.Blocks.looks_renderbox = buildingPrimitiveBlock('box');

    ScratchBlocks.Blocks.looks_addmaterial = {
        init: function () {
            this.jsonInit(looksStatement('add material %1', [
                {type: 'input_value', name: 'MATERIAL'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_clearmaterial = {
        init: function () {
            this.jsonInit(looksStatement('clear material', []));
        }
    };

    ScratchBlocks.Blocks.looks_setalbedofromcolor = {
        init: function () {
            this.jsonInit(looksStatement('set albedo %1 from color: %2', [
                {type: 'input_value', name: 'MATERIAL'},
                {type: 'input_value', name: 'COLOR'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_setalbedofromtexture = {
        init: function () {
            this.jsonInit(looksStatement('set albedo %1 from texture: %2', [
                {type: 'input_value', name: 'MATERIAL'},
                {type: 'input_value', name: 'TEXTURE'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_setemissionfromcolor = {
        init: function () {
            this.jsonInit(looksStatement('set emission %1 from color: %2', [
                {type: 'input_value', name: 'MATERIAL'},
                {type: 'input_value', name: 'COLOR'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_setemissionfromtexture = {
        init: function () {
            this.jsonInit(looksStatement('set emission %1 from texture: %2', [
                {type: 'input_value', name: 'MATERIAL'},
                {type: 'input_value', name: 'TEXTURE'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_setdisplacementmap = {
        init: function () {
            this.jsonInit(looksStatement('set displacement map %1 texture: %2', [
                {type: 'input_value', name: 'MATERIAL'},
                {type: 'input_value', name: 'TEXTURE'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_setnormalmap = {
        init: function () {
            this.jsonInit(looksStatement('set normal map %1 texture: %2', [
                {type: 'input_value', name: 'MATERIAL'},
                {type: 'input_value', name: 'TEXTURE'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_setroughmap = {
        init: function () {
            this.jsonInit(looksStatement('set rough map %1 texture: %2', [
                {type: 'input_value', name: 'MATERIAL'},
                {type: 'input_value', name: 'TEXTURE'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_setmodelframeto = {
        init: function () {
            this.jsonInit({
                message0: 'set model frame to %1',
                args0: [{type: 'input_value', name: 'FRAME'}],
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    };

    ScratchBlocks.Blocks.looks_addrenderingframe = {
        init: function () {
            this.jsonInit({
                message0: 'add rendering frame',
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    };

    ScratchBlocks.Blocks.looks_clearrenderingframe = {
        init: function () {
            this.jsonInit({
                message0: 'clear rendering frame',
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    };

    ScratchBlocks.Blocks.looks_exportrenderingmp4 = {
        init: function () {
            this.jsonInit({
                message0: 'export rendering mp4 %1 framerate: %2',
                args0: [
                    {type: 'field_dropdown', name: 'SOUND', options: renderingSoundsMenu},
                    {type: 'input_value', name: 'FRAMERATE'}
                ],
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    };

    // Legacy projects keep their old opcode, but show the current wording.
    ScratchBlocks.Blocks.looks_switchmodelto = ScratchBlocks.Blocks.looks_rendermodel;

    ScratchBlocks.Blocks.looks_setvideoframeto = {
        init: function () {
            this.jsonInit({
                message0: 'set video frame to %1',
                args0: [{type: 'input_value', name: 'FRAME'}],
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    };

    ScratchBlocks.Blocks.looks_changevideoframeby = {
        init: function () {
            this.jsonInit({
                message0: 'change video frame by %1',
                args0: [{type: 'input_value', name: 'FRAME'}],
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    };

    ScratchBlocks.Blocks.looks_settextfont = {
        init: function () {
            this.jsonInit({
                message0: 'set text font: %1 text: %2',
                args0: [
                    {type: 'input_value', name: 'FONT'},
                    {type: 'input_value', name: 'TEXT'}
                ],
                category: ScratchBlocks.Categories.looks,
                extensions: ['colours_looks', 'shape_statement']
            });
        }
    };

    const looksStatement = (message0, args0, inputsInline = true) => ({
        message0,
        args0,
        inputsInline,
        category: ScratchBlocks.Categories.looks,
        extensions: ['colours_looks', 'shape_statement']
    });

    const effectName = (id, fallback) => ScratchBlocks.ScratchMsgs.translate(id, fallback);
    const graphicEffectOptions = [
        [effectName('LOOKS_EFFECT_COLOR', 'color'), 'COLOR'],
        [effectName('LOOKS_EFFECT_FISHEYE', 'fisheye'), 'FISHEYE'],
        ['gaussian blur', 'GAUSSIANBLUR'],
        ['lens blur', 'LENSBLUR'],
        ['radial blur', 'RADIALBLUR'],
        ['directional blur', 'DIRECTIONALBLUR'],
        [effectName('LOOKS_EFFECT_WHIRL', 'whirl'), 'WHIRL'],
        [effectName('LOOKS_EFFECT_PIXELATE', 'pixelate'), 'PIXELATE'],
        [effectName('LOOKS_EFFECT_MOSAIC', 'mosaic'), 'MOSAIC'],
        [effectName('LOOKS_EFFECT_BRIGHTNESS', 'brightness'), 'BRIGHTNESS'],
        [effectName('LOOKS_EFFECT_GHOST', 'ghost'), 'GHOST']
    ];

    ScratchBlocks.Blocks.looks_changeeffectby = {
        init: function () {
            this.jsonInit(looksStatement(ScratchBlocks.Msg.LOOKS_CHANGEEFFECTBY, [
                {type: 'field_dropdown', name: 'EFFECT', options: graphicEffectOptions},
                {type: 'input_value', name: 'CHANGE'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_seteffectto = {
        init: function () {
            this.jsonInit(looksStatement(ScratchBlocks.Msg.LOOKS_SETEFFECTTO, [
                {type: 'field_dropdown', name: 'EFFECT', options: graphicEffectOptions},
                {type: 'input_value', name: 'VALUE'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_setwidthto = {
        init: function () {
            this.jsonInit(looksStatement('set width to %1 %', [
                {type: 'input_value', name: 'WIDTH'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_setheightto = {
        init: function () {
            this.jsonInit(looksStatement('set height to %1 %', [
                {type: 'input_value', name: 'HEIGHT'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_turbulentdisplace = {
        init: function () {
            this.jsonInit(looksStatement(
                'turbulent displace amount: %1 size: %2 complexity: %3 evolution: %4',
                [
                    {type: 'input_value', name: 'AMOUNT'},
                    {type: 'input_value', name: 'SIZE'},
                    {type: 'input_value', name: 'COMPLEXITY'},
                    {type: 'input_value', name: 'EVOLUTION'}
                ]
            ));
        }
    };

    ScratchBlocks.Blocks.looks_posterize = {
        init: function () {
            this.jsonInit(looksStatement('posterize value: %1', [
                {type: 'input_value', name: 'VALUE'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_rgbshift = {
        init: function () {
            this.jsonInit(looksStatement('rgb shift value: %1 dir: %2 color: %3', [
                {type: 'input_value', name: 'VALUE'},
                {type: 'input_value', name: 'DIR'},
                {type: 'field_dropdown', name: 'COLOR', options: [['RG', 'RG'], ['GB', 'GB'], ['BR', 'BR']]}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_edgedetection = {
        init: function () {
            this.jsonInit(looksStatement('edge detection value: %1', [
                {type: 'input_value', name: 'VALUE'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_circularripple = {
        init: function () {
            this.jsonInit(looksStatement('circular ripple frequency: %1 value: %2 offset: %3', [
                {type: 'input_value', name: 'FREQUENCY'},
                {type: 'input_value', name: 'VALUE'},
                {type: 'input_value', name: 'OFFSET'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_pixelstretch = {
        init: function () {
            this.jsonInit(looksStatement(
                'pixel stretch offset: %1 smoothness: %2 falloff: %3 transform x: %4 % y: %5 % ' +
                'radius: %6 angle: %7',
                [
                    {type: 'input_value', name: 'OFFSET'},
                    {type: 'input_value', name: 'SMOOTHNESS'},
                    {type: 'input_value', name: 'FALLOFF'},
                    {type: 'input_value', name: 'X'},
                    {type: 'input_value', name: 'Y'},
                    {type: 'input_value', name: 'RADIUS'},
                    {type: 'input_value', name: 'ANGLE'}
                ]
            ));
        }
    };

    ScratchBlocks.Blocks.looks_bloom = {
        init: function () {
            this.jsonInit(looksStatement('bloom threshold: %1 blur: %2 value: %3', [
                {type: 'input_value', name: 'THRESHOLD'},
                {type: 'input_value', name: 'BLUR'},
                {type: 'input_value', name: 'VALUE'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_displacementmap = {
        init: function () {
            this.jsonInit(looksStatement('displacement map costume: %1 type: %2 value: %3', [
                {type: 'input_value', name: 'COSTUME'},
                {
                    type: 'field_dropdown',
                    name: 'TYPE',
                    options: [['x', 'x'], ['y', 'y'], ['size', 'size'], ['dir', 'dir']]
                },
                {type: 'input_value', name: 'VALUE'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_effectweight = {
        init: function () {
            this.jsonInit(looksStatement('effect weight costume: %1', [
                {type: 'input_value', name: 'COSTUME'}
            ]));
        }
    };

    ScratchBlocks.Blocks.looks_backdrops.init = function () {
        const json = jsonForMenuBlock('BACKDROP', backdropsMenu, looksColors, []);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.event_whenbackdropswitchesto.init = function () {
        const json = jsonForHatBlockMenu(
            ScratchBlocks.Msg.EVENT_WHENBACKDROPSWITCHESTO,
            'BACKDROP', backdropNamesMenu, eventColors, []);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.motion_pointtowards_menu.init = function () {
        const random = ScratchBlocks.ScratchMsgs.translate('MOTION_POINTTOWARDS_RANDOM', 'random direction');
        const mouse = ScratchBlocks.ScratchMsgs.translate('MOTION_POINTTOWARDS_POINTER', 'mouse-pointer');
        const json = jsonForMenuBlock('TOWARDS', spriteMenu, motionColors, [
            [mouse, '_mouse_'],
            [random, '_random_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.motion_goto_menu.init = function () {
        const random = ScratchBlocks.ScratchMsgs.translate('MOTION_GOTO_RANDOM', 'random position');
        const mouse = ScratchBlocks.ScratchMsgs.translate('MOTION_GOTO_POINTER', 'mouse-pointer');
        const json = jsonForMenuBlock('TO', spriteMenu, motionColors, [
            [random, '_random_'],
            [mouse, '_mouse_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.motion_glideto_menu.init = function () {
        const random = ScratchBlocks.ScratchMsgs.translate('MOTION_GLIDETO_RANDOM', 'random position');
        const mouse = ScratchBlocks.ScratchMsgs.translate('MOTION_GLIDETO_POINTER', 'mouse-pointer');
        const json = jsonForMenuBlock('TO', spriteMenu, motionColors, [
            [random, '_random_'],
            [mouse, '_mouse_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.sensing_of_object_menu.init = function () {
        const stage = ScratchBlocks.ScratchMsgs.translate('SENSING_OF_STAGE', 'Stage');
        const json = jsonForMenuBlock('OBJECT', spriteMenu, sensingColors, [
            [stage, '_stage_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.sensing_of.init = function () {
        const blockId = this.id;
        const blockType = this.type;

        // Get the sensing_of block from vm.
        let defaultSensingOfBlock;
        const blocks = vm.runtime.flyoutBlocks._blocks;
        Object.keys(blocks).forEach(id => {
            const block = blocks[id];
            if (id === blockType || (block && block.opcode === blockType)) {
                defaultSensingOfBlock = block;
            }
        });

        // Function that fills in menu for the first input in the sensing block.
        // Called every time it opens since it depends on the values in the other block input.
        const menuFn = function () {
            const stageOptions = [
                [ScratchBlocks.Msg.SENSING_OF_BACKDROPNUMBER, 'backdrop #'],
                [ScratchBlocks.Msg.SENSING_OF_BACKDROPNAME, 'backdrop name'],
                [ScratchBlocks.Msg.SENSING_OF_VOLUME, 'volume']
            ];
            const spriteOptions = [
                [ScratchBlocks.Msg.SENSING_OF_XPOSITION, 'x position'],
                [ScratchBlocks.Msg.SENSING_OF_YPOSITION, 'y position'],
                [ScratchBlocks.Msg.SENSING_OF_DIRECTION, 'direction'],
                [ScratchBlocks.Msg.SENSING_OF_COSTUMENUMBER, 'costume #'],
                [ScratchBlocks.Msg.SENSING_OF_COSTUMENAME, 'costume name'],
                [ScratchBlocks.Msg.SENSING_OF_SIZE, 'size'],
                [ScratchBlocks.Msg.SENSING_OF_VOLUME, 'volume']
            ];
            if (vm.editingTarget) {
                let lookupBlocks = vm.editingTarget.blocks;
                let sensingOfBlock = lookupBlocks.getBlock(blockId);

                // The block doesn't exist, but should be in the flyout. Look there.
                if (!sensingOfBlock) {
                    sensingOfBlock = vm.runtime.flyoutBlocks.getBlock(blockId) || defaultSensingOfBlock;
                    // If we still don't have a block, just return an empty list . This happens during
                    // scratch blocks construction.
                    if (!sensingOfBlock) {
                        return [['', '']];
                    }
                    // The block was in the flyout so look up future block info there.
                    lookupBlocks = vm.runtime.flyoutBlocks;
                }
                const sort = function (options) {
                    options.sort(ScratchBlocks.scratchBlocksUtils.compareStrings);
                };
                // Get all the stage variables (no lists) so we can add them to menu when the stage is selected.
                const stageVariableOptions = vm.runtime.getTargetForStage().getAllVariableNamesInScopeByType('');
                sort(stageVariableOptions);
                const stageVariableMenuItems = stageVariableOptions.map(variable => [variable, variable]);
                if (sensingOfBlock.inputs.OBJECT.shadow !== sensingOfBlock.inputs.OBJECT.block) {
                    // There's a block dropped on top of the menu. It'd be nice to evaluate it and
                    // return the correct list, but that is tricky. Scratch2 just returns stage options
                    // so just do that here too.
                    return stageOptions.concat(stageVariableMenuItems);
                }
                const menuBlock = lookupBlocks.getBlock(sensingOfBlock.inputs.OBJECT.shadow);
                const selectedItem = menuBlock.fields.OBJECT.value;
                if (selectedItem === '_stage_') {
                    return stageOptions.concat(stageVariableMenuItems);
                }
                // Get all the local variables (no lists) and add them to the menu.
                const target = vm.runtime.getSpriteTargetByName(selectedItem);
                let spriteVariableOptions = [];
                // The target should exist, but there are ways for it not to (e.g. #4203).
                if (target) {
                    spriteVariableOptions = target.getAllVariableNamesInScopeByType('', true);
                    sort(spriteVariableOptions);
                }
                const spriteVariableMenuItems = spriteVariableOptions.map(variable => [variable, variable]);
                return spriteOptions.concat(spriteVariableMenuItems);
            }
            return [['', '']];
        };

        const json = jsonForSensingMenus(menuFn);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.sensing_distancetomenu.init = function () {
        const mouse = ScratchBlocks.ScratchMsgs.translate('SENSING_DISTANCETO_POINTER', 'mouse-pointer');
        const json = jsonForMenuBlock('DISTANCETOMENU', spriteMenu, sensingColors, [
            [mouse, '_mouse_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.sensing_touchingobjectmenu.init = function () {
        const mouse = ScratchBlocks.ScratchMsgs.translate('SENSING_TOUCHINGOBJECT_POINTER', 'mouse-pointer');
        const edge = ScratchBlocks.ScratchMsgs.translate('SENSING_TOUCHINGOBJECT_EDGE', 'edge');
        const json = jsonForMenuBlock('TOUCHINGOBJECTMENU', spriteMenu, sensingColors, [
            [mouse, '_mouse_'],
            [edge, '_edge_']
        ]);
        this.jsonInit(json);
    };

    ScratchBlocks.Blocks.control_create_clone_of_menu.init = function () {
        const json = jsonForMenuBlock('CLONE_OPTION', cloneMenu, controlColors, []);
        this.jsonInit(json);
    };

    ScratchBlocks.VerticalFlyout.getCheckboxState = function (blockId) {
        const monitoredBlock = vm.runtime.monitorBlocks._blocks[blockId];
        return monitoredBlock ? monitoredBlock.isMonitored : false;
    };

    ScratchBlocks.FlyoutExtensionCategoryHeader.getExtensionState = function (extensionId) {
        if (vm.getPeripheralIsConnected(extensionId)) {
            return ScratchBlocks.StatusButtonState.READY;
        }
        return ScratchBlocks.StatusButtonState.NOT_READY;
    };

    ScratchBlocks.FieldNote.playNote_ = function (noteNum, extensionId) {
        vm.runtime.emit('PLAY_NOTE', noteNum, extensionId);
    };

    // Use a collator's compare instead of localeCompare which internally
    // creates a collator. Using this is a lot faster in browsers that create a
    // collator for every localeCompare call.
    const collator = new Intl.Collator([], {
        sensitivity: 'base',
        numeric: true
    });
    ScratchBlocks.scratchBlocksUtils.compareStrings = function (str1, str2) {
        return collator.compare(str1, str2);
    };

    // Blocks wants to know if 3D CSS transforms are supported. The cross
    // section of browsers Scratch supports and browsers that support 3D CSS
    // transforms will make the return always true.
    //
    // Shortcutting to true lets us skip an expensive style recalculation when
    // first loading the Scratch editor.
    ScratchBlocks.utils.is3dSupported = function () {
        return true;
    };

    return ScratchBlocks;
}
