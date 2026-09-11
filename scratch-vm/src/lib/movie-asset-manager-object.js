import {createImagePlane, disposeObject, ModelRenderer, DEFAULT_DEPTH} from './model-runtime';
import {
    BITMAP_RESOLUTION,
    COSTUME_GROUP_SOURCE
} from './movie-asset-manager-constants';
import {
    cloneCamera,
    cloneScale,
    clamp,
    createLineBitmap,
    createShapeBitmap,
    getShapeBitmapCacheKey,
    isWithinTimeWindow,
    normalizeShapeType,
    once,
    toNumber,
    MAX_CACHED_SHAPE_SKINS,
    MAX_CACHED_SHAPE_SKIN_PIXELS
} from './movie-asset-manager-utils';

const MAX_OBJECT_IMAGE_PLANES = 256;

const MovieAssetManagerObjectMethods = {
    getCachedObjectImagePlane (key, bitmap, width, height, rotationCenter) {
        if (!(this.objectImagePlanes instanceof Map)) this.objectImagePlanes = new Map();
        const cached = this.objectImagePlanes.get(key);
        if (cached) {
            // Map insertion order is the LRU order. Reusing the plane also reuses its GPU texture and geometry.
            this.objectImagePlanes.delete(key);
            this.objectImagePlanes.set(key, cached);
            return cached;
        }
        const plane = createImagePlane(bitmap, width, height, rotationCenter);
        this.objectImagePlanes.set(key, plane);
        while (this.objectImagePlanes.size > MAX_OBJECT_IMAGE_PLANES) {
            this.objectImagePlanes.delete(this.objectImagePlanes.keys().next().value);
        }
        return plane;
    },

    cloneObjectDrawConfiguration (configuration) {
        const clone = {
            ...configuration,
            position: {...(configuration.position || {})},
            rotation: {...(configuration.rotation || {})},
            scale: {...(configuration.scale || {})}
        };
        if (configuration.time) clone.time = {...configuration.time};
        return clone;
    },

    getObjectEvaluationTime (configuration) {
        const localTime = Number(configuration && configuration.evaluationTime);
        if (Number.isFinite(localTime)) return localTime;

        const source = String((configuration && configuration.source) || '').toLowerCase();
        const videoMode = String((configuration && configuration.videoMode) || '').toLowerCase();
        if (source === 'video' && videoMode === 'video') {
            const clock = this.runtime && this.runtime.ioDevices && this.runtime.ioDevices.clock;
            if (clock && typeof clock.projectTimer === 'function') {
                const sensingTime = Number(clock.projectTimer());
                const rawTime = typeof clock.projectTimerWithoutOffset === 'function' ?
                    Number(clock.projectTimerWithoutOffset()) : null;
                const hasTimerOffset = Number.isFinite(rawTime) && Math.abs(sensingTime - rawTime) > 1e-9;
                const timelineIsActive = this.timeline && (this.timeline.playing || this.timeline.recording);
                if (Number.isFinite(sensingTime) && (!timelineIsActive || hasTimerOffset)) return sensingTime;
            }
        }
        return this.timeline ? toNumber(this.timeline.currentTime) : 0;
    },

    createObjectSceneCapture (target, requestedCamera = null) {
        if (!target || target.isStage) return null;
        return {
            camera: requestedCamera || cloneCamera(this.camera),
            entries: [],
            targetId: target.id
        };
    },

    captureObjectSceneDraw (target, configuration, drawKind = 'object') {
        const capture = configuration && configuration.sceneCapture;
        if (!capture || capture.targetId !== target.id || !Array.isArray(capture.entries)) return;
        const entry = this.cloneObjectDrawConfiguration(configuration);
        delete entry.sceneCapture;
        if (drawKind !== 'object') entry.movieDrawKind = drawKind;
        capture.entries.push(entry);
    },

    getShapeSceneConfiguration (configuration) {
        const shape = normalizeShapeType(configuration.shape);
        if (shape !== 'line') return {...configuration, shape};
        const point1 = configuration.position1 || {};
        const point2 = configuration.position2 || {};
        return {
            ...configuration,
            position: {
                x: (toNumber(point1.x) + toNumber(point2.x)) / 2,
                y: (toNumber(point1.y) + toNumber(point2.y)) / 2,
                z: (toNumber(point1.z) + toNumber(point2.z)) / 2
            },
            rotation: {x: 0, y: 0, z: 0},
            scale: {x: 1, y: 1, z: 1},
            shape,
            size: 100
        };
    },

    getObjectSceneTransform (target, configuration, isPlane = false) {
        const position = configuration.position || {};
        const rotation = configuration.rotation || {};
        const requestedScale = configuration.scale || {};
        const state = this.getTargetState(target);
        const scale = cloneScale(requestedScale);
        if (isPlane) {
            scale.x *= toNumber(configuration.width, 100) / 100;
            scale.y *= toNumber(configuration.height, 100) / 100;
        }
        return {
            rotation: {
                x: toNumber(rotation.x),
                y: toNumber(rotation.y),
                z: toNumber(rotation.z)
            },
            rotationOrder: state.rotationOrder,
            scale,
            size: toNumber(configuration.size, 100),
            worldX: toNumber(position.x),
            worldY: toNumber(position.y),
            worldZ: toNumber(position.z, DEFAULT_DEPTH)
        };
    },

    getActiveObjectSceneConfiguration (target, configuration) {
        const source = String(configuration.source || 'costume').toLowerCase();
        const playsVideo = source === 'video' && String(configuration.videoMode || '').toLowerCase() === 'video';
        if (playsVideo) {
            const video = this.getVideoByName(target, configuration.asset);
            if (!video) {
                this.stopObjectVideoAudio(target, configuration);
                return null;
            }
            const currentTime = this.getObjectEvaluationTime(configuration);
            const playback = this.getObjectVideoPlayback(video, configuration, currentTime);
            if (!playback || !playback.active) {
                this.stopObjectVideoAudio(target, configuration);
                return null;
            }
            this.syncObjectVideoAudio(target, video, configuration, playback, currentTime);
            return {...configuration, frame: playback.frame};
        }
        this.stopObjectVideoAudio(target, configuration);
        if (
            configuration.time &&
            !isWithinTimeWindow(configuration.time, this.getObjectEvaluationTime(configuration))
        ) {
            return null;
        }
        return configuration;
    },

    copyBitmapToCanvas (bitmap) {
        const width = Math.max(1, Number(bitmap && (bitmap.videoWidth || bitmap.naturalWidth || bitmap.width)) || 1);
        const height = Math.max(
            1,
            Number(bitmap && (bitmap.videoHeight || bitmap.naturalHeight || bitmap.height)) || 1
        );
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create an Objects scene image.');
        context.drawImage(bitmap, 0, 0, width, height);
        canvas.reusable = false;
        return canvas;
    },

    prepareShapeSceneItem (target, requestedConfiguration) {
        const configuration = this.getShapeSceneConfiguration(requestedConfiguration);
        if (configuration.time &&
            !isWithinTimeWindow(configuration.time, this.getObjectEvaluationTime(configuration))) {
            return null;
        }
        const cacheKey = `shape:${getShapeBitmapCacheKey(configuration)}`;
        let sourceObject = this.objectImagePlanes instanceof Map ? this.objectImagePlanes.get(cacheKey) : null;
        if (!sourceObject) {
            const bitmap = configuration.shape === 'line' ?
                createLineBitmap(configuration) : createShapeBitmap(configuration);
            if (!bitmap) return null;
            const bitmapResolution = Math.max(0.001, toNumber(bitmap.movieBitmapResolution, BITMAP_RESOLUTION));
            sourceObject = this.getCachedObjectImagePlane(
                cacheKey,
                bitmap,
                bitmap.width / bitmapResolution,
                bitmap.height / bitmapResolution
            );
        }
        return {
            item: {
                animationName: '',
                frame: 1,
                sourceObject,
                transform: this.getObjectSceneTransform(target, configuration)
            },
            resource: sourceObject,
            ownsResource: false
        };
    },

    async prepareObjectSceneItem (target, requestedConfiguration, videoFrameBitmaps = null) {
        if (requestedConfiguration.movieDrawKind === 'shape') {
            return this.prepareShapeSceneItem(target, requestedConfiguration);
        }
        const configuration = this.getActiveObjectSceneConfiguration(target, requestedConfiguration);
        if (!configuration) return null;
        const source = String(configuration.source || 'costume').toLowerCase();
        if (source === 'model') {
            const model = this.getModelByName(target, configuration.asset);
            if (!model) return null;
            return {
                item: {
                    animationName: model.activeMotion,
                    frame: Math.max(1, toNumber(configuration.frame, 1)),
                    sourceObject: await this.getModelObject(model),
                    transform: this.getObjectSceneTransform(target, configuration)
                },
                resource: null
            };
        }

        let bitmap;
        let logicalWidth;
        let logicalHeight;
        let rotationCenter;
        let planeCacheKey = null;
        let videoFrameResource = null;
        if (source === 'costume' || source === COSTUME_GROUP_SOURCE) {
            const costume = this.getCostumeForObjectDraw(
                target,
                source,
                configuration.asset,
                configuration.frame
            );
            if (!costume || !costume.asset || typeof costume.asset.encodeDataURI !== 'function') return null;
            const cached = this.getBuildingTexture(costume, 'albedo');
            const texture = cached.texture || await cached.promise;
            const resolution = Math.max(1, toNumber(costume.bitmapResolution, 1));
            const image = texture.image || {};
            logicalWidth = costume.size ? toNumber(costume.size[0]) / resolution :
                toNumber(image.naturalWidth || image.width, 1) / resolution;
            logicalHeight = costume.size ? toNumber(costume.size[1]) / resolution :
                toNumber(image.naturalHeight || image.height, 1) / resolution;
            rotationCenter = {
                x: toNumber(costume.rotationCenterX, (logicalWidth * resolution) / 2) / resolution,
                y: toNumber(costume.rotationCenterY, (logicalHeight * resolution) / 2) / resolution
            };
            bitmap = texture;
            planeCacheKey = `costume:${costume.assetId || costume.name}:${logicalWidth}:${logicalHeight}:` +
                `${rotationCenter.x}:${rotationCenter.y}`;
        } else if (source === 'video') {
            const video = this.getVideoByName(target, configuration.asset);
            if (!video) return null;
            const state = this.getTargetState(target);
            const frame = this.getVideoFrameNumber(video, configuration.frame);
            const frameKey = `${video.assetId}:${frame}`;
            const cachedFrame = videoFrameBitmaps && videoFrameBitmaps.get(frameKey);
            if (cachedFrame) {
                videoFrameResource = cachedFrame;
                bitmap = cachedFrame.bitmap;
            } else {
                const element = await this.decodeObjectVideoFrame(state, video, frame);
                const frameBitmap = await this.snapshotVideoFrame(element);
                bitmap = frameBitmap.bitmap;
                videoFrameResource = frameBitmap;
                if (videoFrameBitmaps) videoFrameBitmaps.set(frameKey, frameBitmap);
            }
            const videoElement = state.objectVideo || {};
            const sourceWidth = Number(video.width || videoElement.videoWidth || bitmap.width || 1);
            const sourceHeight = Number(video.height || videoElement.videoHeight || bitmap.height || 1);
            logicalWidth = sourceWidth / BITMAP_RESOLUTION;
            logicalHeight = sourceHeight / BITMAP_RESOLUTION;
        } else if (source === 'text') {
            const font = this.getFont(configuration.asset);
            const fontLoad = this.ensureFontLoaded(font.name);
            if (fontLoad) await fontLoad;
            const text = String(configuration.text);
            bitmap = this.createTextCanvas(font, text);
            const bitmapResolution = Math.max(
                0.001,
                toNumber(bitmap.movieBitmapResolution, BITMAP_RESOLUTION)
            );
            logicalWidth = bitmap.width / bitmapResolution;
            logicalHeight = bitmap.height / bitmapResolution;
            planeCacheKey = `text:${font.name}:${font.family}:${text}`;
        } else {
            return null;
        }

        const cachedVideoPlane = videoFrameResource && videoFrameResource.plane;
        const sourceObject = cachedVideoPlane || (planeCacheKey ? this.getCachedObjectImagePlane(
            planeCacheKey,
            bitmap,
            logicalWidth,
            logicalHeight,
            rotationCenter
        ) : createImagePlane(bitmap, logicalWidth, logicalHeight, rotationCenter));
        if (videoFrameResource && videoFrameBitmaps) videoFrameResource.plane = sourceObject;
        return {
            item: {
                animationName: '',
                frame: 1,
                sourceObject,
                transform: this.getObjectSceneTransform(target, configuration, true)
            },
            resource: sourceObject,
            ownsResource: !planeCacheKey && !(videoFrameResource && videoFrameBitmaps)
        };
    },

    async performObjectScene (target, capture, requestedState, requestedVersion) {
        const state = requestedState || this.getTargetState(target);
        const version = typeof requestedVersion === 'number' ? requestedVersion : state.objectDrawVersion;
        const camera = capture.camera || cloneCamera(this.camera);
        const prepared = [];
        const videoFrameBitmaps = new Map();
        try {
            // Resolve in block order. In particular, two frames from one video share a decoder element and must
            // be copied before the following seek changes it.
            for (const entry of capture.entries) {
                const result = await this.prepareObjectSceneItem(target, entry, videoFrameBitmaps);
                if (result) prepared.push(result);
                if (this.targetStates.get(target.id) !== state || state.objectDrawVersion !== version) return;
            }
            if (!prepared.length) return;
            if (!this.modelRenderer) this.modelRenderer = new ModelRenderer();
            const renderArguments = [
                prepared.map(result => result.item),
                camera,
                this.getStageSize(),
                BITMAP_RESOLUTION
            ];
            if (Array.isArray(this.lights)) renderArguments.push(this.lights);
            const canvas = this.modelRenderer.renderWorldScene(...renderArguments);
            this.applyBitmap(target, canvas, 'scene');
            this.publishModelZBuffer(target, camera);
            this.finishObjectDraw(target, {}, 'model', false, camera);
        } finally {
            prepared.forEach(result => {
                if (result.resource && result.ownsResource !== false) disposeObject(result.resource);
            });
            videoFrameBitmaps.forEach(frameBitmap => {
                if (frameBitmap.plane) disposeObject(frameBitmap.plane);
                this.closeVideoBitmap(frameBitmap.bitmap);
            });
        }
    },

    applyObjectDrawConfiguration (target, configuration) {
        const position = configuration.position || {};
        const rotation = configuration.rotation || {};
        const scale = configuration.scale || {};
        const state = this.getTargetState(target);
        state.projectionKey = null;
        this.projectionBatchDepth = (this.projectionBatchDepth || 0) + 1;
        try {
            this.setTargetPosition(target, position.x, position.y, position.z);
            this.setTargetRotation(target, rotation.x, rotation.y, rotation.z);
            this.setTargetScale(target, scale.x, scale.y, scale.z);
            if (typeof target.setSize === 'function') target.setSize(toNumber(configuration.size, 100));

            const graphicEffects = this.runtime.graphicEffectsManager;
            if (graphicEffects && typeof graphicEffects.setScale === 'function') {
                // Line shapes derive their dimensions from their endpoints and do not provide width/height.
                // Do not turn an omitted dimension into zero in the graphic-effects state, or the line's
                // drawable scale becomes [0, 0] before it is stamped.
                if (typeof configuration.width !== 'undefined') {
                    graphicEffects.setScale(target, 'width', configuration.width);
                }
                if (typeof configuration.height !== 'undefined') {
                    graphicEffects.setScale(target, 'height', configuration.height);
                }
            }
        } finally {
            this.projectionBatchDepth--;
        }
    },

    finishObjectDraw (target, configuration, source, reapplyConfiguration = false, requestedCamera = null) {
        if (reapplyConfiguration) this.applyObjectDrawConfiguration(target, configuration);
        const state = this.getTargetState(target);
        // Objects video is a Pen source. Keep its drawable available for stamping, but do not leave the
        // unprocessed video visible above the Pen layer where it would cover the grouped Pen FX result.
        // Every Objects draw is a Pen stamp. Keeping its temporary source drawable visible would let a later
        // camera operation move that source above the already-stamped pixels, which looks like the later camera
        // changed an earlier Draw node.
        state.penOnly = true;
        // Size, per-axis dimensions, and costume changes update Scratch's drawable transform directly.
        // Reapply Movie's shared 3D transform last so draw uses the same position/rotation/scale state as
        // the corresponding Motion and Looks blocks, including Z perspective.
        const camera = requestedCamera || cloneCamera(this.camera);
        if (camera) this.applyProjection(target, camera);
        else this.applyProjection(target);
        this.stampTarget(target);
        if (source !== 'model') {
            if (camera) this.publishFlatZBuffer(target, camera);
            else this.publishFlatZBuffer(target);
        }
    },

    getVideoFrameNumber (video, requestedFrame) {
        const maximumFrame = video.duration > 0 ?
            Math.max(1, Math.floor(video.duration * video.frameRate) + 1) : Number.MAX_SAFE_INTEGER;
        const numericFrame = Number(requestedFrame);
        return Math.round(clamp(Number.isFinite(numericFrame) ? numericFrame : 1, 1, maximumFrame));
    },

    getObjectVideoPlaybackKey (target, configuration = {}) {
        const playbackId = String(configuration.playbackId || configuration.asset || 'video');
        return `${target.id}:${playbackId}`;
    },

    getObjectVideoPlayback (video, configuration, currentTime) {
        if (String(configuration.videoMode || '').toLowerCase() !== 'video') return null;
        const start = configuration.time ?
            toNumber(configuration.time.start, 0) : 0;
        const requestedEnd = configuration.time ?
            toNumber(configuration.time.end, Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
        const numericSpeed = Number(configuration.speed);
        const speed = Number.isFinite(numericSpeed) && numericSpeed > 0 ? numericSpeed : 1;
        const videoDuration = toNumber(video && video.duration);
        const mediaEnd = videoDuration > 0 && Number.isFinite(start) ? start + (videoDuration / speed) :
            Number.POSITIVE_INFINITY;
        const end = Math.min(requestedEnd, mediaEnd);
        const mediaTime = Math.max(0, (currentTime - start) * speed);
        return {
            active: currentTime >= start && currentTime < end,
            end,
            frame: this.getVideoFrameNumber(video, (mediaTime * video.frameRate) + 1),
            mediaTime,
            speed,
            start,
            volume: clamp(toNumber(configuration.volume, 100), 0, 100)
        };
    },

    recordObjectVideoAudio (target, video, configuration, playback, currentTime) {
        const volume = playback.volume * this.getProjectVolume();
        if (!this.timeline || !this.timeline.recording || volume <= 0) return;
        if (!(this.playedTimelineSoundBlocks instanceof Set)) this.playedTimelineSoundBlocks = new Set();
        if (!Array.isArray(this.renderingSoundEvents)) this.renderingSoundEvents = [];
        const key = `object-video:${this.getObjectVideoPlaybackKey(target, configuration)}`;
        if (this.playedTimelineSoundBlocks.has(key)) return;
        this.playedTimelineSoundBlocks.add(key);
        this.renderingSoundEvents.push({
            dedupeKey: key,
            duration: Math.max(0, playback.end - currentTime),
            frame: this.timeline.renderFrameIndex,
            offset: this.getVideoSourceTimeAtTime(video, playback.mediaTime),
            playbackRate: playback.speed,
            video,
            volume
        });
    },

    getProjectVolume () {
        const audioEngine = this.runtime && this.runtime.audioEngine;
        const gain = audioEngine && audioEngine.inputNode && audioEngine.inputNode.gain;
        return clamp(toNumber(gain && gain.value, 1), 0, 1);
    },

    setObjectVideoAudioProperties (element, playback) {
        element.muted = false;
        element.volume = (playback.volume / 100) * this.getProjectVolume();
        element.playbackRate = playback.speed;
        // The speed control intentionally changes pitch together with duration.
        if ('preservesPitch' in element) element.preservesPitch = false;
        if ('mozPreservesPitch' in element) element.mozPreservesPitch = false;
        if ('webkitPreservesPitch' in element) element.webkitPreservesPitch = false;
    },

    startObjectVideoAudio (key, entry, playback) {
        if (entry.startPromise) return;
        const version = ++entry.version;
        let ready = Promise.resolve();
        if (entry.element.readyState < 1) ready = once(entry.element, 'loadedmetadata');
        const startPromise = ready.then(() => {
            if (!(this.objectVideoAudio instanceof Map) || this.objectVideoAudio.get(key) !== entry ||
                entry.version !== version) return;
            this.setObjectVideoAudioProperties(entry.element, playback);
            const duration = Number(entry.element.duration);
            const requestedTime = entry.video ?
                this.getVideoSourceTimeAtTime(entry.video, playback.mediaTime) : playback.mediaTime;
            const maximumTime = Number.isFinite(duration) ? Math.max(0, duration - 0.001) : requestedTime;
            entry.element.currentTime = clamp(requestedTime, 0, maximumTime);
            const playResult = entry.element.play();
            if (playResult && typeof playResult.then === 'function') return playResult;
        }).catch(error => {
            // A browser may reject autoplay before the user has interacted with the page. Keep video rendering
            // available, and let the next user-initiated timeline playback try the audio again.
            if (error && error.name !== 'AbortError' && error.name !== 'NotAllowedError') {
                this.emit('renderError', error);
            }
        });
        entry.startPromise = startPromise;
        const finish = () => {
            if (entry.startPromise === startPromise) entry.startPromise = null;
        };
        startPromise.then(finish, finish);
    },

    syncObjectVideoAudio (target, video, configuration, playback, currentTime) {
        const key = this.getObjectVideoPlaybackKey(target, configuration);
        if (!(this.objectVideoAudioSeen instanceof Set)) this.objectVideoAudioSeen = new Set();
        this.objectVideoAudioSeen.add(key);
        if (this.timeline && this.timeline.recording) {
            this.stopObjectVideoAudioEntry(
                key,
                this.objectVideoAudio instanceof Map ? this.objectVideoAudio.get(key) : null
            );
            this.recordObjectVideoAudio(target, video, configuration, playback, currentTime);
            return;
        }
        if (!this.timeline || !this.timeline.playing || typeof document === 'undefined') {
            this.stopObjectVideoAudio(target, configuration);
            return;
        }
        if (!(this.objectVideoAudio instanceof Map)) this.objectVideoAudio = new Map();
        let entry = this.objectVideoAudio.get(key);
        if (entry && entry.assetId !== video.assetId) {
            this.stopObjectVideoAudioEntry(key, entry);
            entry = null;
        }
        if (!entry) {
            const element = document.createElement('audio');
            element.preload = 'auto';
            element.src = video.url;
            entry = {
                assetId: video.assetId,
                element,
                startPromise: null,
                targetId: target.id,
                version: 0,
                video
            };
            this.objectVideoAudio.set(key, entry);
        }

        this.setObjectVideoAudioProperties(entry.element, playback);
        entry.video = video;
        const requestedTime = this.getVideoSourceTimeAtTime(video, playback.mediaTime);
        if (entry.element.readyState >= 1 && Number.isFinite(Number(entry.element.currentTime)) &&
            Math.abs(Number(entry.element.currentTime) - requestedTime) > 0.15) {
            const duration = Number(entry.element.duration);
            const maximumTime = Number.isFinite(duration) ? Math.max(0, duration - 0.001) : requestedTime;
            entry.element.currentTime = clamp(requestedTime, 0, maximumTime);
        }
        if (entry.element.paused !== false) this.startObjectVideoAudio(key, entry, playback);
    },

    hasDisplayedObjectVideoFrame (state, video, frame) {
        return state.mode === 'video' &&
            state.displayedVideoAssetId === video.assetId &&
            state.displayedFrame === frame &&
            !state.pendingVideoFrame &&
            (!Array.isArray(state.videoFrameQueue) || state.videoFrameQueue.length === 0) &&
            !state.videoRenderPromise;
    },

    queueObjectDraw (target, configuration, requestedCamera = null) {
        const state = this.getTargetState(target);
        state.objectDrawQueue.push({
            camera: requestedCamera || cloneCamera(this.camera),
            configuration: this.cloneObjectDrawConfiguration(configuration),
            version: state.objectDrawVersion
        });
        return this.startObjectDrawQueue(target, state);
    },

    renderObjectScene (target, capture) {
        if (!target || target.isStage || !capture || capture.targetId !== target.id) return;
        const state = this.getTargetState(target);
        state.objectDrawQueue.push({
            sceneCapture: capture,
            version: state.objectDrawVersion
        });
        return this.startObjectDrawQueue(target, state);
    },

    startObjectDrawQueue (target, state) {
        if (state.objectDrawPromise) return state.objectDrawPromise;

        const renderPromise = Promise.resolve().then(() => this.renderQueuedObjectDraws(target, state));
        state.objectDrawPromise = renderPromise;
        const finish = () => {
            if (state.objectDrawPromise !== renderPromise) return;
            state.objectDrawPromise = null;
            if (state.objectDrawQueue.length && this.targetStates.get(target.id) === state) {
                this.runWithoutWaiting(this.startObjectDrawQueue(target, state));
            }
        };
        renderPromise.then(finish, finish);
        return renderPromise;
    },

    async renderQueuedObjectDraws (target, state) {
        while (state.objectDrawQueue.length && this.targetStates.get(target.id) === state) {
            const request = state.objectDrawQueue.shift();
            if (request.version !== state.objectDrawVersion) continue;
            if (request.sceneCapture) {
                await this.performObjectScene(target, request.sceneCapture, state, request.version);
                continue;
            }
            const configuration = request.configuration;
            const source = String(configuration.source || 'costume').toLowerCase();

            if (source === 'video') {
                const video = this.getVideoByName(target, configuration.asset);
                if (!video) continue;
                const frame = this.getVideoFrameNumber(video, configuration.frame);
                // The queue itself is pending, but the previous request may already have uploaded this frame.
                if (this.hasDisplayedObjectVideoFrame(state, video, frame)) {
                    this.applyObjectDrawConfiguration(target, configuration);
                    this.finishObjectDraw(target, configuration, source, false, request.camera);
                    continue;
                }
                const element = await this.decodeObjectVideoFrame(state, video, frame);
                const frameBitmap = await this.snapshotVideoFrame(element);
                if (
                    this.targetStates.get(target.id) !== state ||
                    request.version !== state.objectDrawVersion
                ) {
                    this.closeVideoBitmap(frameBitmap.bitmap);
                    continue;
                }
                this.applyObjectDrawConfiguration(target, configuration);
                this.applyBitmap(
                    target,
                    frameBitmap.bitmap,
                    'video',
                    null,
                    true,
                    frameBitmap.bitmapResolution
                );
                state.currentFrame = frame;
                state.videoAssetId = video.assetId;
                state.displayedFrame = frame;
                state.displayedVideoAssetId = video.assetId;
                this.finishObjectDraw(target, configuration, source, false, request.camera);
                continue;
            }

            const render = this.performObjectDraw(target, configuration, request.camera);
            if (render && typeof render.then === 'function') await render;
        }
    },

    async prepareObjectVideoElement (state, video) {
        if (state.objectVideo && state.objectVideoAssetId === video.assetId) return state.objectVideo;
        if (state.objectVideo) {
            state.objectVideo.removeAttribute('src');
            state.objectVideo.load();
        }
        const element = document.createElement('video');
        element.muted = true;
        element.preload = 'auto';
        element.src = video.url;
        if (element.readyState < 1) await once(element, 'loadedmetadata');
        element.width = element.videoWidth;
        element.height = element.videoHeight;
        this.commitObjectVideoElement(state, element, video.assetId);
        return element;
    },

    commitObjectVideoElement (state, element, assetId) {
        state.objectVideo = element;
        state.objectVideoAssetId = assetId;
    },

    async decodeObjectVideoFrame (state, video, frame) {
        const element = await this.prepareObjectVideoElement(state, video);
        const time = this.getVideoSourceTime(video, frame);
        if (element.readyState < 2) await once(element, 'loadeddata');
        if (Math.abs(element.currentTime - time) > 0.0001) {
            const seeked = once(element, 'seeked');
            element.currentTime = time;
            await seeked;
        }
        return element;
    },

    performObjectDraw (target, configuration, requestedCamera = null) {
        this.applyObjectDrawConfiguration(target, configuration);
        const source = String(configuration.source || 'costume').toLowerCase();
        let render;
        if (source === 'costume' || source === COSTUME_GROUP_SOURCE) {
            const costume = this.getCostumeForObjectDraw(
                target,
                source,
                configuration.asset,
                configuration.frame
            );
            const costumeIndex = this.getCostumeIndexForObjectDraw(
                target,
                costume,
                source === 'costume' ? configuration.asset : null
            );
            if (costumeIndex < 0 || typeof target.setCostume !== 'function') return;
            const state = this.getTargetState(target);
            if (state.mode !== 'costume' || target.currentCostume !== costumeIndex) {
                target.setCostume(costumeIndex);
            }
        } else if (source === 'text') {
            this.setText(target, configuration.asset, configuration.text);
            const state = this.getTargetState(target);
            render = state.textRenderPromise;
        } else if (source === 'model') {
            if (!this.getModelByName(target, configuration.asset)) return;
            const state = this.getTargetState(target);
            const frame = Number(configuration.frame);
            state.modelFrame = Number.isFinite(frame) ? Math.max(1, frame) : 1;
            render = requestedCamera ? this.replaceModelScene(target, configuration.asset, requestedCamera) :
                this.replaceModelScene(target, configuration.asset);
        } else {
            return;
        }

        const finishDraw = () => this.finishObjectDraw(
            target,
            configuration,
            source,
            Boolean(render && typeof render.then === 'function'),
            requestedCamera
        );
        if (render && typeof render.then === 'function') return render.then(finishDraw);
        finishDraw();
    },

    drawObject (target, configuration = {}, graphParent = null) {
        if (this.enqueueFrameGraphDraw('object', target, configuration, graphParent)) return;
        return this.drawObjectImmediately(target, configuration);
    },

    drawObjectImmediately (target, configuration = {}, requestedCamera = null) {
        if (!target || target.isStage) return;
        const camera = requestedCamera || cloneCamera(this.camera);
        const source = String(configuration.source || 'costume').toLowerCase();
        if (!['costume', COSTUME_GROUP_SOURCE, 'video', 'text', 'model'].includes(source)) return;
        if (configuration.sceneCapture) {
            this.captureObjectSceneDraw(target, configuration);
            return;
        }
        const playsVideo = source === 'video' && String(configuration.videoMode || '').toLowerCase() === 'video';
        let drawConfiguration = configuration;
        if (playsVideo) {
            const video = this.getVideoByName(target, configuration.asset);
            if (!video) {
                this.stopObjectVideoAudio(target, configuration);
                return;
            }
            const currentTime = this.getObjectEvaluationTime(configuration);
            const playback = this.getObjectVideoPlayback(video, configuration, currentTime);
            if (!playback || !playback.active) {
                this.stopObjectVideoAudio(target, configuration);
                return;
            }
            this.syncObjectVideoAudio(target, video, configuration, playback, currentTime);
            drawConfiguration = {...configuration, frame: playback.frame};
        } else {
            this.stopObjectVideoAudio(target, configuration);
        }
        if (drawConfiguration.time && !playsVideo &&
            !isWithinTimeWindow(drawConfiguration.time, this.getObjectEvaluationTime(drawConfiguration))) {
            return;
        }
        if (source === 'video') {
            const video = this.getVideoByName(target, drawConfiguration.asset);
            if (!video) return;
            const state = this.getTargetState(target);
            const frame = this.getVideoFrameNumber(video, drawConfiguration.frame);
            if (!state.objectDrawPromise && this.hasDisplayedObjectVideoFrame(state, video, frame)) {
                this.applyObjectDrawConfiguration(target, drawConfiguration);
                this.finishObjectDraw(target, drawConfiguration, source, false, camera);
                return;
            }
            return camera ? this.queueObjectDraw(target, drawConfiguration, camera) :
                this.queueObjectDraw(target, drawConfiguration);
        }
        const state = this.getTargetState(target);
        if (state.objectDrawPromise || source === 'model') {
            return camera ? this.queueObjectDraw(target, drawConfiguration, camera) :
                this.queueObjectDraw(target, drawConfiguration);
        }
        return this.performObjectDraw(target, drawConfiguration, camera);
    },

    renderShape (target, configuration = {}, requestedCamera = null) {
        if (!target || target.isStage || !this.runtime.renderer) return;
        const shape = normalizeShapeType(configuration.shape);
        const drawConfiguration = this.getShapeSceneConfiguration(configuration);
        const shapeConfiguration = shape === 'line' ? drawConfiguration : {...configuration, shape};
        const skinId = this.getShapeSkin(shapeConfiguration);
        if (skinId === null) return;

        const state = this.getTargetState(target);
        state.renderVersion++;
        state.requestedMode = 'shape';
        this.clearPendingVideoFrames(state);
        state.textQueue.length = 0;
        state.modelRenderVersion++;
        state.modelScene = [];
        state.modelAssetId = null;
        state.mode = 'shape';
        state.textKey = null;
        state.projectionKey = null;
        state.penOnly = true;
        state.shapeSkinId = skinId;

        this.applyObjectDrawConfiguration(target, drawConfiguration);
        // Cached procedural skins follow the same cheap stamp path as costume skins. Geometry, color and opacity
        // select the skin; position, rotation and scale only update the drawable transform.
        this.runtime.renderer.updateDrawableSkinId(target.drawableID, skinId);
        this.finishObjectDraw(target, drawConfiguration, 'shape', false, requestedCamera);
        this.trimShapeSkinCache(skinId);
    },

    getShapeSkin (configuration) {
        if (!(this.shapeSkinCache instanceof Map)) {
            this.shapeSkinCache = new Map();
            this.shapeSkinCachePixels = 0;
        }
        const key = getShapeBitmapCacheKey(configuration);
        const cached = this.shapeSkinCache.get(key);
        if (cached) {
            // Map insertion order is the LRU order.
            this.shapeSkinCache.delete(key);
            this.shapeSkinCache.set(key, cached);
            return cached.skinId;
        }

        const bitmap = normalizeShapeType(configuration.shape) === 'line' ?
            createLineBitmap(configuration) : createShapeBitmap(configuration);
        if (!bitmap) return null;
        const bitmapResolution = toNumber(bitmap.movieBitmapResolution, BITMAP_RESOLUTION);
        const skinId = this.runtime.renderer.createBitmapSkin(bitmap, bitmapResolution);
        if (skinId === null || typeof skinId === 'undefined') return null;
        const pixels = Math.max(1, toNumber(bitmap.width, 1) * toNumber(bitmap.height, 1));
        this.shapeSkinCache.set(key, {pixels, skinId});
        this.shapeSkinCachePixels += pixels;
        return skinId;
    },

    trimShapeSkinCache (currentSkinId) {
        if (!(this.shapeSkinCache instanceof Map)) return;
        const activeSkinIds = new Set([currentSkinId]);
        for (const state of this.targetStates.values()) {
            if (state.mode === 'shape' && state.shapeSkinId !== null) activeSkinIds.add(state.shapeSkinId);
        }
        while (
            this.shapeSkinCache.size > MAX_CACHED_SHAPE_SKINS ||
            this.shapeSkinCachePixels > MAX_CACHED_SHAPE_SKIN_PIXELS
        ) {
            let evictedKey = null;
            let evicted = null;
            for (const [key, entry] of this.shapeSkinCache) {
                if (!activeSkinIds.has(entry.skinId)) {
                    evictedKey = key;
                    evicted = entry;
                    break;
                }
            }
            if (!evicted) return;
            this.shapeSkinCache.delete(evictedKey);
            this.shapeSkinCachePixels -= evicted.pixels;
            if (typeof this.runtime.renderer.destroySkin === 'function') {
                this.runtime.renderer.destroySkin(evicted.skinId);
            }
        }
    },

    drawShape (target, configuration = {}, graphParent = null) {
        if (this.enqueueFrameGraphDraw('shape', target, configuration, graphParent)) return;
        return this.drawShapeImmediately(target, configuration);
    },

    drawShapeImmediately (target, configuration = {}, requestedCamera = null) {
        if (!target || target.isStage) return;
        if (configuration.sceneCapture) {
            this.captureObjectSceneDraw(target, configuration, 'shape');
            return;
        }
        if (configuration.time &&
            !isWithinTimeWindow(configuration.time, this.getObjectEvaluationTime(configuration))) {
            return;
        }
        return this.renderShape(target, configuration, requestedCamera || cloneCamera(this.camera));
    }
};

export default MovieAssetManagerObjectMethods;
