import compatBlocks from 'scratch-vm/src/compiler/compat-blocks';

import {
    MOVIE_3D_BLOCKS,
    MOVIE_3D_REPORTER_BLOCKS,
    MOVIE_ASSET_BLOCKS
} from './project-format';

const MovieAssetManagerPrimitiveMethods = {
    installPrimitives () {
        const primitives = this.runtime._primitives;
        // Render a named frame atomically. Waiting here guarantees that a following Pen stamp consumes the
        // requested video frame instead of the sprite's previous costume, text, or model skin.
        primitives.looks_rendervideo = (args, util) => this.trackBlockingVideoRender(
            this.renderVideo(util.target, args.VIDEO, args.FRAME)
        );
        // Keep the original video controls loadable without changing their scheduling behavior. New projects use
        // render-video-at-frame so selecting and decoding a stamp source cannot race the following block.
        primitives.looks_switchvideoto = (args, util) => {
            this.runWithoutWaiting(this.switchVideo(util.target, args.VIDEO));
        };
        primitives.looks_setvideoframeto = (args, util) => {
            this.runWithoutWaiting(this.setVideoFrame(util.target, args.FRAME));
        };
        primitives.looks_changevideoframeby = (args, util) => {
            this.runWithoutWaiting(this.changeVideoFrame(util.target, args.FRAME));
        };
        primitives.looks_settextfont = (args, util) => {
            this.setText(util.target, args.FONT, args.TEXT);
        };
        // Queue the empty scene without displaying it before a following render model block.
        primitives.looks_clearscene = (args, util) => {
            if (this.enqueueFrameGraphSceneOperation('clear-models', util.target)) return;
            this.runWithoutWaiting(this.clearModelScene(util.target));
        };
        // Timeline playback tracks pending visual work separately. Never put the render-frame script into
        // promise-wait mode, or repeated hats can prevent the model from appearing during playback.
        primitives.looks_rendermodel = (args, util) => {
            if (this.enqueueFrameGraphSceneOperation('render-model', util.target, {model: args.MODEL})) return;
            this.runWithoutWaiting(this.renderModelToScene(util.target, args.MODEL));
        };
        // Building blocks must not yield between erase-all and stamp; otherwise the cleared pen frame flashes.
        primitives.looks_renderwall = (args, util) => {
            if (this.enqueueFrameGraphSceneOperation('render-building', util.target, {
                arguments: {...args},
                primitive: 'wall'
            })) return;
            this.runWithoutWaiting(this.renderBuildingPrimitive('wall', args, util.target));
        };
        primitives.looks_renderfloor = (args, util) => {
            if (this.enqueueFrameGraphSceneOperation('render-building', util.target, {
                arguments: {...args},
                primitive: 'floor'
            })) return;
            this.runWithoutWaiting(this.renderBuildingPrimitive('floor', args, util.target));
        };
        primitives.looks_renderbox = (args, util) => {
            if (this.enqueueFrameGraphSceneOperation('render-building', util.target, {
                arguments: {...args},
                primitive: 'box'
            })) return;
            this.runWithoutWaiting(this.renderBuildingPrimitive('box', args, util.target));
        };
        primitives.looks_clearmaterial = () => this.clearBuildingMaterials();
        primitives.looks_addmaterial = args => this.addBuildingMaterial(args.MATERIAL);
        primitives.looks_setalbedofromcolor = args => this.setBuildingMaterialColor(
            args.MATERIAL, 'albedo', args.COLOR
        );
        primitives.looks_setemissionfromcolor = args => this.setBuildingMaterialColor(
            args.MATERIAL, 'emission', args.COLOR
        );
        // Texture decoding continues in the background without putting the current script into promise-wait mode.
        primitives.looks_setalbedofromtexture = (args, util) => {
            this.runWithoutWaiting(this.setBuildingMaterialTexture(
                args.MATERIAL, 'albedo', args.TEXTURE, util.target
            ));
        };
        primitives.looks_setemissionfromtexture = (args, util) => {
            this.runWithoutWaiting(this.setBuildingMaterialTexture(
                args.MATERIAL, 'emission', args.TEXTURE, util.target
            ));
        };
        primitives.looks_setdisplacementmap = (args, util) => {
            this.runWithoutWaiting(this.setBuildingMaterialTexture(
                args.MATERIAL, 'displacement', args.TEXTURE, util.target
            ));
        };
        primitives.looks_setnormalmap = (args, util) => {
            this.runWithoutWaiting(this.setBuildingMaterialTexture(
                args.MATERIAL, 'normal', args.TEXTURE, util.target
            ));
        };
        primitives.looks_setroughmap = (args, util) => {
            this.runWithoutWaiting(this.setBuildingMaterialTexture(
                args.MATERIAL, 'roughness', args.TEXTURE, util.target
            ));
        };
        // Frame selection itself is synchronous. Rendering can continue in the background so a render-frame hat
        // is not restarted before it reaches a following render-model block.
        primitives.looks_setmodelframeto = (args, util) => {
            if (this.enqueueFrameGraphSceneOperation('set-model-frame', util.target, {frame: args.FRAME})) return;
            this.runWithoutWaiting(this.setModelFrame(util.target, args.FRAME));
        };
        primitives.looks_clearlight = () => this.clearLights();
        primitives.looks_addpointlight = args => this.addLight('point', args);
        primitives.looks_addlight = args => this.addLight('spot', args);
        // Keep old projects working. The legacy switch block replaces the scene instead of accumulating into it.
        primitives.looks_switchmodelto = (args, util) => this.replaceModelScene(util.target, args.MODEL);
        primitives.looks_addrenderingframe = () => this.addRenderingFrame();
        primitives.looks_clearrenderingframe = () => this.clearRenderingFrames();
        primitives.looks_exportrenderingmp4 = (args, util) => this.exportRenderingMp4(
            util && util.target,
            args && args.SOUND,
            args && args.FRAMERATE
        );
        const stopAllSounds = primitives.sound_stopallsounds;
        primitives.sound_stopallsounds = (args, util) => {
            this.stopTimelineSounds();
            if (typeof stopAllSounds === 'function') return stopAllSounds(args, util);
        };
        // Keep the frame-based block loadable for projects created before the time-based block replaced it.
        primitives.sound_playatframe = (args, util) => this.playSoundAtFrame(args, util);
        primitives.sound_playattime = (args, util) => this.playSoundAtTime(args, util);

        const goToXYZ = (args, util) => this.setTargetPosition(
            util.target,
            args.X,
            args.Y,
            typeof args.Z === 'undefined' ? this.getTargetState(util.target).worldZ : args.Z
        );
        primitives.motion_gotoxy = goToXYZ;
        primitives.motion_gotoxyz = goToXYZ;
        primitives.motion_gotoxyz_nocamera = (args, util) => this.setTargetPositionWithoutCamera(
            util.target,
            args.X,
            args.Y,
            typeof args.Z === 'undefined' ? this.getTargetState(util.target).worldZ : args.Z
        );
        primitives.motion_changexby = (args, util) => this.changeTargetPosition(util.target, 'x', args.DX);
        primitives.motion_setx = (args, util) => this.setTargetAxis(util.target, 'x', args.X);
        primitives.motion_changeyby = (args, util) => this.changeTargetPosition(util.target, 'y', args.DY);
        primitives.motion_sety = (args, util) => this.setTargetAxis(util.target, 'y', args.Y);
        primitives.motion_changezby = (args, util) => this.changeTargetPosition(util.target, 'z', args.DZ);
        primitives.motion_setz = (args, util) => this.setTargetAxis(util.target, 'z', args.Z);
        primitives.motion_setrotation = (args, util) => this.setTargetRotation(
            util.target, args.X, args.Y, args.Z
        );
        primitives.motion_setscale = (args, util) => this.setTargetScale(
            util.target, args.X, args.Y, args.Z
        );
        primitives.motion_changerotationby = (args, util) => this.changeTargetRotation(
            util.target, args.X, args.Y, args.Z
        );
        primitives.motion_setrotationorder = (args, util) => this.setTargetRotationOrder(util.target, args.ORDER);
        primitives.motion_setcamerato = args => this.setCameraPosition(args.X, args.Y, args.Z);
        primitives.motion_setcamerax = args => this.setCameraAxis('x', args.X);
        primitives.motion_changecameraxby = args => this.changeCameraAxis('x', args.X);
        primitives.motion_setcameray = args => this.setCameraAxis('y', args.Y);
        primitives.motion_changecamerayby = args => this.changeCameraAxis('y', args.Y);
        primitives.motion_setcameraz = args => this.setCameraAxis('z', args.Z);
        primitives.motion_changecamerazby = args => this.changeCameraAxis('z', args.X);
        primitives.motion_setcamerarotation = args => this.setCameraRotation(args.X, args.Y, args.Z);
        primitives.motion_changecamerarotationby = args => this.changeCameraRotation(args.X, args.Y, args.Z);
        primitives.motion_setcamerarotationorder = args => this.setCameraRotationOrder(args.ORDER);
        primitives.motion_lookat = args => this.lookAt(args);
        primitives.motion_setfov = args => this.setFOV(args.FOV);

        primitives.motion_zposition = (args, util) => this.getTargetState(util.target).worldZ;
        primitives.motion_rotationx = (args, util) => this.getTargetState(util.target).rotation.x;
        primitives.motion_rotationy = (args, util) => this.getTargetState(util.target).rotation.y;
        primitives.motion_rotationz = (args, util) => this.getTargetState(util.target).rotation.z;
        primitives.motion_rotationorder = (args, util) => this.getTargetState(util.target).rotationOrder;
        primitives.motion_camerax = () => this.camera.position.x;
        primitives.motion_cameray = () => this.camera.position.y;
        primitives.motion_cameraz = () => this.camera.position.z;
        primitives.motion_camerarotationx = () => this.camera.rotation.x;
        primitives.motion_camerarotationy = () => this.camera.rotation.y;
        primitives.motion_camerarotationz = () => this.camera.rotation.z;
        primitives.motion_camerarotationorder = () => this.camera.rotationOrder;
        primitives.motion_fov = () => this.camera.fov;
        primitives.motion_focallength = () => this.camera.focalLength;

        for (const opcode of MOVIE_ASSET_BLOCKS.concat(MOVIE_3D_BLOCKS)) {
            if (!compatBlocks.stacked.includes(opcode)) compatBlocks.stacked.push(opcode);
        }
        for (const opcode of MOVIE_3D_REPORTER_BLOCKS) {
            if (!compatBlocks.inputs.includes(opcode)) compatBlocks.inputs.push(opcode);
        }
    },

    runWithoutWaiting (promise) {
        if (!promise || typeof promise.then !== 'function') return;
        const initializePromises = this.timeline && this.timeline.initializing &&
            this.timeline.initializePromises instanceof Set ? this.timeline.initializePromises : null;
        if (initializePromises) initializePromises.add(promise);
        const finish = () => {
            if (initializePromises) initializePromises.delete(promise);
        };
        promise.then(finish, error => {
            finish();
            this.emit('renderError', error);
        });
    },

    rerenderLightedModelScenes () {
        const renders = [];
        for (const target of this.runtime.targets || []) {
            const state = this.targetStates.get(target.id);
            if (!state || state.requestedMode !== 'model' || !state.modelScene.length) continue;
            const render = this.queueModelSceneRender(target);
            if (render && typeof render.then === 'function') renders.push(render);
        }
        if (renders.length) return Promise.all(renders);
    },

    clearLights () {
        this.lights = [];
        return this.rerenderLightedModelScenes();
    },

    addLight (type, args = {}) {
        const light = {
            angle: args.ANGLE,
            color: args.COLOR,
            intensity: args.INTENSITY,
            position: {x: args.X, y: args.Y, z: args.Z},
            radius: args.RADIUS,
            shadow: args.SHADOW,
            type
        };
        // The first authored light replaces the preview-oriented studio setup. Further blocks accumulate lights.
        this.lights = (Array.isArray(this.lights) ? this.lights : []).concat(light);
        return this.rerenderLightedModelScenes();
    },

    trackBlockingVideoRender (promise) {
        if (!promise || typeof promise.then !== 'function') return promise;
        if (!(this.blockingVideoRenders instanceof Set)) this.blockingVideoRenders = new Set();
        this.blockingVideoRenders.add(promise);
        const finish = () => this.blockingVideoRenders.delete(promise);
        promise.then(finish, error => {
            finish();
            this.emit('renderError', error);
        });
        return promise;
    },

    hasBlockingVideoRenders () {
        return this.blockingVideoRenders instanceof Set && this.blockingVideoRenders.size > 0;
    },

    hasActiveRenderFrameThreads () {
        const renderFrameThreads = this.timeline && this.timeline.renderFrameThreads;
        const runtimeThreads = this.runtime && this.runtime.threads;
        if (!Array.isArray(renderFrameThreads) || !Array.isArray(runtimeThreads)) return false;
        return renderFrameThreads.some(thread => runtimeThreads.indexOf(thread) !== -1);
    },

    hasActiveInitializeThreads () {
        const initializeThreads = this.timeline && this.timeline.initializeThreads;
        const runtimeThreads = this.runtime && this.runtime.threads;
        if (!Array.isArray(initializeThreads) || !Array.isArray(runtimeThreads)) return false;
        return initializeThreads.some(thread => runtimeThreads.indexOf(thread) !== -1);
    },

    hasPendingVisualRenders () {
        if (this.frameGraphRenderPromise ||
            (this.frameGraphRenderer && this.frameGraphRenderer.pendingRender)) return true;
        if (!(this.targetStates instanceof Map)) return false;
        for (const state of this.targetStates.values()) {
            if (state.objectDrawPromise || state.objectDrawQueue.length > 0) return true;
            if (state.requestedMode === 'model' && state.modelRenderPromise) return true;
            if (state.requestedMode === 'text' && (state.textRenderPromise || state.textQueue.length > 0)) return true;
            if (
                state.requestedMode === 'video' &&
                (state.videoRenderPromise || state.pendingVideoFrame ||
                    (Array.isArray(state.videoFrameQueue) && state.videoFrameQueue.length > 0))
            ) return true;
        }
        return false;
    }
};

export default MovieAssetManagerPrimitiveMethods;
