import {
    getMovieProjectFeatures,
    getProjectExtension,
    isMovieProject,
    markMovieProject
} from '../../../src/lib/project-format';
import sb3 from 'scratch-vm/src/serialization/sb3';

const block = (opcode, fields = {}) => ({
    opcode,
    next: null,
    parent: null,
    inputs: {},
    fields,
    shadow: false,
    topLevel: true
});

const project = blocks => ({
    targets: [{blocks}],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0'}
});

describe('Movie project format', () => {
    test('marks custom movie blocks in project.json without changing them', () => {
        const customBlock = block('looks_switchvideoto');
        const json = project({customBlock});

        markMovieProject(json);

        expect(json.targets[0].blocks.customBlock).toBe(customBlock);
        expect(json.mb3).toEqual({version: 1, features: ['movie-blocks']});
        expect(isMovieProject(json)).toBe(true);
    });

    test('marks the easing operator as a Movie block', () => {
        const json = project({easing: block('operator_easing')});

        expect(getMovieProjectFeatures(json)).toEqual(['movie-blocks']);
        expect(getProjectExtension({
            targets: [{blocks: {_blocks: json.targets[0].blocks}}]
        })).toBe('shade');
    });

    test('marks the timer offset command as a Movie block', () => {
        expect(getMovieProjectFeatures(project({timerOffset: block('sensing_settimeroffsetto')})))
            .toEqual(['movie-blocks']);
    });

    test('marks object drawing, grouping, and z-buffer scenes as Movie blocks', () => {
        const json = project({
            draw: block('objects_draw'),
            shape: block('objects_shape'),
            grouping: block('objects_grouping'),
            scene: block('objects_scene')
        });

        expect(getMovieProjectFeatures(json)).toEqual(['3d-engine', 'movie-blocks']);
    });

    test('marks the connected Bezier pass reporter as a Movie block', () => {
        expect(getMovieProjectFeatures(project({pass: block('objects_pass')}))).toEqual(['movie-blocks']);
    });

    test('marks built-in Pen FX blocks as Movie project data', () => {
        const json = project({contrast: block('penfx_contrast')});

        expect(getMovieProjectFeatures(json)).toEqual(['pen-fx']);
        expect(getProjectExtension({
            targets: [{blocks: {_blocks: json.targets[0].blocks}}]
        })).toBe('shade');
    });

    test('marks My Blocks Shader definitions as Movie project data', () => {
        const json = project({shader: block('myblocksshader_return')});

        expect(getMovieProjectFeatures(json)).toEqual(['my-blocks-shader']);
        expect(getProjectExtension({
            targets: [{blocks: {_blocks: json.targets[0].blocks}}]
        })).toBe('shade');
    });

    test('round-trips custom opcodes and inputs through project.json block serialization', () => {
        const blocks = {
            command: {
                ...block('looks_settextfont'),
                inputs: {
                    FONT: {block: 'font', shadow: 'font'},
                    TEXT: {block: 'text', shadow: 'text'}
                }
            },
            font: {
                ...block('text', {TEXT: {value: 'Movie Sans'}}),
                id: 'font',
                parent: 'command',
                shadow: true,
                topLevel: false
            },
            text: {
                ...block('text', {TEXT: {value: 'hello'}}),
                id: 'text',
                parent: 'command',
                shadow: true,
                topLevel: false
            }
        };

        const [serialized] = sb3.serializeBlocks(blocks);
        const hydrated = sb3.deserializeBlocks(JSON.parse(JSON.stringify(serialized)));

        expect(hydrated.command.opcode).toBe('looks_settextfont');
        expect(hydrated.command.inputs.FONT.block).toBe(hydrated.command.inputs.FONT.shadow);
        expect(hydrated[hydrated.command.inputs.FONT.block].fields.TEXT.value).toBe('Movie Sans');
        expect(hydrated[hydrated.command.inputs.TEXT.block].fields.TEXT.value).toBe('hello');
    });

    test('recognizes custom values added to Scratch looks effect blocks', () => {
        const json = project({
            effect: block('looks_seteffectto', {EFFECT: ['GAUSSIANBLUR']})
        });

        expect(getMovieProjectFeatures(json)).toEqual(['graphic-effects']);
        markMovieProject(json);
        expect(json.mb3.features).toEqual(['graphic-effects']);
    });

    test('marks video descriptors as Movie-only project data', () => {
        const json = project({});
        json.movieVideos = [{name: 'clip', md5ext: 'asset.mp4'}];

        expect(getMovieProjectFeatures(json)).toEqual(['video-assets']);
    });

    test('marks costume groups as Movie-only project data', () => {
        const json = project({});
        json.movieCostumeGroups = [{
            costumeAssetIds: ['svg-one', 'svg-two'],
            name: 'Walk'
        }];

        expect(getMovieProjectFeatures(json)).toEqual(['costume-groups']);
    });

    test('marks the atomic video render block as Movie project data', () => {
        const json = project({video: block('looks_rendervideo')});

        expect(getMovieProjectFeatures(json)).toEqual(['movie-blocks']);
    });

    test('marks model assets and 3D motion blocks as Movie 3D project data', () => {
        const json = project({
            camera: block('motion_setcamerarotation'),
            fov: block('motion_setfov'),
            noCamera: block('motion_gotoxyz_nocamera'),
            clear: block('looks_clearscene'),
            model: block('looks_rendermodel'),
            scale: block('motion_setscale')
        });
        json.movieModels = [{name: 'cube', md5ext: 'asset.glb'}];

        expect(getMovieProjectFeatures(json)).toEqual(['3d-engine', 'model-assets', 'movie-blocks']);
        markMovieProject(json);
        expect(json.mb3.features).toEqual(['3d-engine', 'model-assets', 'movie-blocks']);
    });

    test('marks model lighting blocks as Movie 3D project data', () => {
        const json = project({
            clear: block('looks_clearlight'),
            point: block('looks_addpointlight'),
            spot: block('looks_addlight')
        });

        expect(getMovieProjectFeatures(json)).toEqual(['3d-engine', 'movie-blocks']);
    });

    test('marks building geometry and material blocks as Movie project data', () => {
        const json = project({
            clear: block('looks_clearmaterial'),
            displacement: block('looks_setdisplacementmap'),
            material: block('looks_addmaterial'),
            normal: block('looks_setnormalmap'),
            roughness: block('looks_setroughmap'),
            texture: block('looks_setalbedofromtexture'),
            wall: block('looks_renderwall')
        });

        expect(getMovieProjectFeatures(json)).toEqual(['3d-engine', 'movie-blocks']);
    });

    test('marks rendering export blocks as Movie project data', () => {
        const json = project({export: block('looks_exportrenderingmp4')});

        expect(getMovieProjectFeatures(json)).toEqual(['movie-blocks']);
        expect(getProjectExtension({
            targets: [{blocks: {_blocks: json.targets[0].blocks}}]
        })).toBe('shade');
    });

    test('marks the initialize and render frame hats as Movie project data', () => {
        const json = project({
            initialize: block('event_initialize'),
            render: block('event_renderframe'),
            sound: block('sound_playattime')
        });
        json.movieTimeline = {duration: 12, framerate: 24, width: 1920, height: 1080};

        expect(getMovieProjectFeatures(json)).toEqual(['movie-blocks', 'timeline']);
    });

    test('marks saved camera and target transforms without requiring a model', () => {
        const json = project({});
        json.movieCamera = {
            position: {x: 0, y: 0, z: -100}
        };
        json.targets[0].movie3D = {
            z: 720,
            rotation: {x: 15, y: 0, z: 0},
            rotationOrder: 'YXZ'
        };

        expect(getMovieProjectFeatures(json)).toEqual(['3d-engine']);
    });

    test('keeps plain Scratch projects as sb3', () => {
        const runtime = {
            targets: [{blocks: {_blocks: {move: block('motion_movesteps')}}}]
        };

        expect(getProjectExtension(runtime)).toBe('sb3');
        expect(markMovieProject(project({move: block('motion_movesteps')})).mb3).toBeUndefined();
    });

    test('uses shade for hydrated custom blocks in the runtime', () => {
        const runtime = {
            targets: [{blocks: {_blocks: {
                text: block('looks_settextfont')
            }}}]
        };

        expect(getProjectExtension(runtime)).toBe('shade');
    });
});
