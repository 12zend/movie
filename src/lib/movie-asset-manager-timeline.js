import {
    TIMELINE_DEFAULT_DURATION,
    TIMELINE_MAX_DURATION
} from './movie-asset-manager-constants';
import {
    clamp,
    normalizeTimelineKeyframes,
    toNumber
} from './movie-asset-manager-utils';

// The timeline playhead is driven by the underlying clock. Project scripts read the offset clock instead.
const getTimelineClockTime = clock => {
    if (clock && typeof clock.projectTimerWithoutOffset === 'function') {
        return clock.projectTimerWithoutOffset();
    }
    return clock && typeof clock.projectTimer === 'function' ? clock.projectTimer() : 0;
};

const MovieAssetManagerTimelineMethods = {
    serializeTimeline () {
        return {
            duration: this.timeline.duration,
            exportFormat: this.timeline.exportFormat,
            framerate: this.timeline.framerate,
            height: this.timeline.height,
            keyframes: this.getTimelineKeyframes(),
            rangeEnd: this.timeline.rangeEnd,
            rangeStart: this.timeline.rangeStart,
            reuseFrames: this.timeline.reuseFrames,
            sound: this.timeline.sound,
            width: this.timeline.width
        };
    },

    getTimelineSettings () {
        const rangeStart = clamp(toNumber(this.timeline.rangeStart), 0, this.timeline.duration);
        return {
            duration: this.timeline.duration,
            exportFormat: this.normalizeRenderingFormat(this.timeline.exportFormat),
            framerate: this.timeline.framerate,
            height: this.timeline.height,
            rangeEnd: clamp(
                toNumber(this.timeline.rangeEnd, this.timeline.duration),
                rangeStart,
                this.timeline.duration
            ),
            rangeStart,
            reuseFrames: this.timeline.reuseFrames !== false,
            width: this.timeline.width
        };
    },

    restoreTimeline (descriptor) {
        const [stageWidth, stageHeight] = this.getStageSize();
        const hasSettings = descriptor && typeof descriptor === 'object';
        const settings = hasSettings ? descriptor : {};
        const currentFramerate = this.runtime.frameLoop && this.runtime.frameLoop.framerate;
        this.timeline.currentTime = 0;
        this.timeline.duration = this.normalizeTimelineDuration(settings.duration);
        this.timeline.exportFormat = this.normalizeRenderingFormat(settings.exportFormat);
        this.timeline.framerate = this.normalizeRenderingFramerate(
            hasSettings ? settings.framerate : currentFramerate
        );
        this.timeline.height = Math.max(1, Math.round(toNumber(settings.height, stageHeight)));
        this.timeline.initializePromises = new Set();
        this.timeline.initializeThreads = [];
        this.timeline.initializing = false;
        this.timeline.offlineRenderScheduled = false;
        this.timeline.offlineRenderTimer = null;
        this.timeline.offlineRendering = false;
        this.timeline.keyframes = normalizeTimelineKeyframes(settings.keyframes, this.timeline.duration);
        this.timeline.pendingFrame = true;
        this.timeline.playing = false;
        this.timeline.recording = false;
        this.timeline.rangeStart = clamp(toNumber(settings.rangeStart), 0, this.timeline.duration);
        this.timeline.rangeEnd = clamp(
            toNumber(settings.rangeEnd, this.timeline.duration),
            this.timeline.rangeStart,
            this.timeline.duration
        );
        this.timeline.renderFrameThreads = [];
        this.timeline.sound = String(settings.sound || '');
        this.timeline.reuseFrames = settings.reuseFrames !== false;
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.timeline.width = Math.max(1, Math.round(toNumber(settings.width, stageWidth)));
        this.setTimelineClock(0, true);
        if (hasSettings) {
            this.vm.setFramerate(this.timeline.framerate);
        }
        this.emitTimelineChanged();
    },

    normalizeTimelineDuration (value) {
        const duration = Number(value);
        if (!Number.isFinite(duration) || duration <= 0) return TIMELINE_DEFAULT_DURATION;
        return Math.min(TIMELINE_MAX_DURATION, Math.max(0.1, duration));
    },

    getTimelineState () {
        const rangeStart = clamp(toNumber(this.timeline.rangeStart), 0, this.timeline.duration);
        return {
            currentTime: this.timeline.currentTime,
            duration: this.timeline.duration,
            exportFormat: this.normalizeRenderingFormat(this.timeline.exportFormat),
            frameCount: Array.isArray(this.renderingFrames) ? this.renderingFrames.length : 0,
            framerate: this.timeline.framerate,
            height: this.timeline.height,
            keyframes: this.getTimelineKeyframes(),
            playing: this.timeline.playing,
            rangeEnd: clamp(
                toNumber(this.timeline.rangeEnd, this.timeline.duration),
                rangeStart,
                this.timeline.duration
            ),
            rangeStart,
            recording: this.timeline.recording,
            reuseFrames: this.timeline.reuseFrames !== false,
            sound: this.timeline.sound,
            width: this.timeline.width
        };
    },

    emitTimelineChanged () {
        this.emit('timelineChanged', this.getTimelineState());
    },

    getTimelineKeyframes () {
        return normalizeTimelineKeyframes(this.timeline.keyframes, this.timeline.duration);
    },

    getKeyframeTime (id) {
        const keyframes = this.getTimelineKeyframes();
        if (!keyframes.length) return 0;
        const position = clamp(toNumber(id, 1), 1, keyframes.length) - 1;
        const leftIndex = Math.floor(position);
        const rightIndex = Math.ceil(position);
        if (leftIndex === rightIndex) return keyframes[leftIndex];
        const progress = position - leftIndex;
        return keyframes[leftIndex] + ((keyframes[rightIndex] - keyframes[leftIndex]) * progress);
    },

    getLeftKeyframeTime (firstId, secondId) {
        return Math.min(this.getKeyframeTime(firstId), this.getKeyframeTime(secondId));
    },

    addTimelineKeyframe (seconds = this.timeline.currentTime) {
        const time = clamp(toNumber(seconds), 0, this.timeline.duration);
        const keyframes = normalizeTimelineKeyframes(
            this.getTimelineKeyframes().concat([time]),
            this.timeline.duration
        );
        if (keyframes.length === this.getTimelineKeyframes().length) return;
        this.timeline.keyframes = keyframes;
        this.emitTimelineChanged();
        this.runtime.emitProjectChanged();
    },

    removeTimelineKeyframe (id) {
        const keyframes = this.getTimelineKeyframes();
        const index = Math.round(toNumber(id)) - 1;
        if (index < 0 || index >= keyframes.length) return;
        keyframes.splice(index, 1);
        this.timeline.keyframes = keyframes;
        this.emitTimelineChanged();
        this.runtime.emitProjectChanged();
    },

    setTimelineClock (seconds, paused) {
        const time = clamp(toNumber(seconds), 0, this.timeline.duration);
        const clock = this.runtime.ioDevices.clock;
        this.runtime.updateCurrentMSecs();
        clock._projectTimer.startTime = this.runtime.currentMSecs - (time * 1000);
        clock._pausedTime = time * 1000;
        clock._paused = Boolean(paused);
        this.timeline.currentTime = time;
    },

    playTimeline () {
        this.cancelPenFrameTransaction();
        this.cancelPendingObjectDraws();
        if (this.timeline.currentTime >= this.timeline.duration) this.timeline.currentTime = 0;
        this.playedTimelineSoundBlocks.clear();
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.setTimelineClock(this.timeline.currentTime, false);
        this.timeline.initializePromises = new Set();
        this.timeline.initializeThreads = [];
        this.timeline.initializing = false;
        this.timeline.pendingFrame = true;
        this.timeline.playing = true;
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.playTimelineSounds(this.timeline.currentTime);
        this.emitTimelineChanged();
    },

    pauseTimeline () {
        this.cancelPenFrameTransaction();
        this.cancelPendingObjectDraws();
        const clock = this.runtime.ioDevices.clock;
        if (this.timeline.playing) {
            this.timeline.currentTime = clamp(getTimelineClockTime(clock), 0, this.timeline.duration);
        }
        this.timeline.playing = false;
        this.timeline.initializePromises = new Set();
        this.timeline.initializeThreads = [];
        this.timeline.initializing = false;
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.setTimelineClock(this.timeline.currentTime, true);
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.restorePreviewRendererSize();
        this.restoreOfflineRendering();
        this.emitTimelineChanged();
    },

    stopTimeline () {
        this.cancelPenFrameTransaction();
        this.cancelPendingObjectDraws();
        const cancelledRendering = this.timeline.recording;
        this.playedTimelineSoundBlocks.clear();
        this.timeline.playing = false;
        this.timeline.recording = false;
        this.timeline.initializePromises = new Set();
        this.timeline.initializeThreads = [];
        this.timeline.initializing = false;
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.restorePreviewRendererSize();
        this.restoreOfflineRendering();
        this.setTimelineClock(0, true);
        this.timeline.pendingFrame = true;
        this.emitTimelineChanged();
        if (cancelledRendering) this.emit('timelineRenderCancelled');
    },

    seekTimeline (seconds) {
        this.cancelPenFrameTransaction();
        this.cancelPendingObjectDraws();
        const wasPlaying = this.timeline.playing;
        this.playedTimelineSoundBlocks.clear();
        this.stopTimelineSounds();
        this.runtime.stopAll();
        this.setTimelineClock(seconds, !wasPlaying);
        this.timeline.initializePromises = new Set();
        this.timeline.initializeThreads = [];
        this.timeline.initializing = false;
        this.timeline.pendingFrame = true;
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        if (wasPlaying) this.playTimelineSounds(this.timeline.currentTime);
        this.emitTimelineChanged();
    },

    requestTimelinePreviewRefresh () {
        clearTimeout(this.timelinePreviewRefreshTimeout);
        this.timelinePreviewRefreshTimeout = setTimeout(() => {
            this.timelinePreviewRefreshTimeout = null;
            if (this.timeline.playing || this.timeline.recording) return;
            this.seekTimeline(this.timeline.currentTime);
        }, 0);
    },

    handleProjectChanged () {
        // Render-frame scripts can update serializable Movie state themselves. Refreshing in response to those
        // updates would continuously restart a paused preview, so only edits made outside the frame transaction
        // should schedule another evaluation at the current timeline time.
        if (this.timeline.renderedThisStep) return;
        this.renderCacheGeneration = (Number(this.renderCacheGeneration) || 0) + 1;
        if (this.renderingFrameCache instanceof Map) this.renderingFrameCache.clear();
        if (this.renderingSoundEventCache instanceof Map) this.renderingSoundEventCache.clear();
        this.requestTimelinePreviewRefresh();
    },

    updateTimelineSettings (settings, options = {}) {
        const previousSettings = this.getTimelineSettings();
        const previousDuration = this.timeline.duration;
        this.timeline.duration = this.normalizeTimelineDuration(settings.duration);
        this.timeline.keyframes = normalizeTimelineKeyframes(this.timeline.keyframes, this.timeline.duration);
        if (Object.prototype.hasOwnProperty.call(settings, 'exportFormat')) {
            this.timeline.exportFormat = this.normalizeRenderingFormat(settings.exportFormat);
        }
        this.timeline.framerate = this.normalizeRenderingFramerate(settings.framerate);
        this.timeline.height = Math.max(1, Math.min(4096, Math.round(toNumber(settings.height, this.timeline.height))));
        if (Object.prototype.hasOwnProperty.call(settings, 'sound')) {
            this.timeline.sound = String(settings.sound || '');
        }
        if (Object.prototype.hasOwnProperty.call(settings, 'reuseFrames')) {
            this.timeline.reuseFrames = settings.reuseFrames !== false;
        }
        const currentRangeStart = toNumber(this.timeline.rangeStart);
        const currentRangeEnd = toNumber(this.timeline.rangeEnd, this.timeline.duration);
        this.timeline.rangeStart = clamp(
            toNumber(settings.rangeStart, currentRangeStart),
            0,
            this.timeline.duration
        );
        this.timeline.rangeEnd = clamp(
            toNumber(settings.rangeEnd, Math.max(this.timeline.rangeStart, currentRangeEnd)),
            this.timeline.rangeStart,
            this.timeline.duration
        );
        this.timeline.width = Math.max(1, Math.min(4096, Math.round(toNumber(settings.width, this.timeline.width))));
        this.vm.setFramerate(this.timeline.framerate);
        if (this.timeline.currentTime > this.timeline.duration || previousDuration !== this.timeline.duration) {
            this.seekTimeline(Math.min(this.timeline.currentTime, this.timeline.duration));
        } else {
            this.timeline.pendingFrame = true;
            this.emitTimelineChanged();
        }
        const nextSettings = this.getTimelineSettings();
        const settingsChanged = JSON.stringify(previousSettings) !== JSON.stringify(nextSettings);
        if (settingsChanged) {
            this.emit('timelineSettingsChanged', nextSettings, {
                previousSettings,
                remote: options.remote === true
            });
        }
        if (settingsChanged) this.runtime.emitProjectChanged();
    },

    getRenderingFrameCacheKey (frameIndex) {
        return [
            this.renderCacheGeneration,
            this.timeline.width,
            this.timeline.height,
            this.timeline.framerate,
            frameIndex
        ].join(':');
    },

    getRenderEndTime () {
        return Number.isFinite(Number(this.timeline.renderEndTime)) ?
            Number(this.timeline.renderEndTime) : this.timeline.duration;
    },

    prepareOfflineRendering () {
        this.timeline.offlineRendering = true;
        this.timeline.offlineRenderToken = (Number(this.timeline.offlineRenderToken) || 0) + 1;
        const frameLoop = this.runtime.frameLoop;
        this.timeline.offlineFrameLoopWasRunning = Boolean(frameLoop && frameLoop.running);
        if (this.timeline.offlineFrameLoopWasRunning && typeof frameLoop.stop === 'function') frameLoop.stop();
        this.timeline.offlinePreviousTurboMode = this.runtime.turboMode;
        this.runtime.turboMode = true;
    },

    restoreOfflineRendering () {
        if (!this.timeline.offlineRendering && !this.timeline.offlineFrameLoopWasRunning) return;
        if (this.timeline.offlineRenderTimer !== null && typeof this.timeline.offlineRenderTimer !== 'undefined') {
            clearTimeout(this.timeline.offlineRenderTimer);
        }
        this.timeline.offlineRenderTimer = null;
        this.timeline.offlineRenderScheduled = false;
        this.timeline.offlineRendering = false;
        this.runtime.turboMode = this.timeline.offlinePreviousTurboMode;
        const frameLoop = this.runtime.frameLoop;
        if (this.timeline.offlineFrameLoopWasRunning && frameLoop && !frameLoop.running &&
            typeof frameLoop.start === 'function') frameLoop.start();
        this.timeline.offlineFrameLoopWasRunning = false;
        this.timeline.offlinePreviousTurboMode = null;
    },

    getOfflineRenderPromises () {
        const promises = [];
        const add = promise => {
            if (promise && typeof promise.then === 'function' && promises.indexOf(promise) === -1) {
                promises.push(promise);
            }
        };
        const addSet = set => {
            if (!(set instanceof Set)) return;
            set.forEach(add);
        };
        addSet(this.timeline.initializePromises);
        addSet(this.blockingVideoRenders);
        add(this.frameGraphRenderPromise);
        if (this.targetStates instanceof Map) {
            for (const state of this.targetStates.values()) {
                add(state.objectDrawPromise);
                add(state.modelRenderPromise);
                add(state.textRenderPromise);
                add(state.videoRenderPromise);
            }
        }
        return promises;
    },

    scheduleOfflineRenderStep () {
        if (!this.timeline.offlineRendering || !this.timeline.recording ||
            typeof this.runtime._step !== 'function' || this.timeline.offlineRenderScheduled) return;
        this.timeline.offlineRenderScheduled = true;
        const token = this.timeline.offlineRenderToken;
        const run = () => {
            this.timeline.offlineRenderTimer = null;
            this.timeline.offlineRenderScheduled = false;
            if (!this.timeline.offlineRendering || !this.timeline.recording ||
                token !== this.timeline.offlineRenderToken) return;
            this.runOfflineRenderStep();
        };
        this.timeline.offlineRenderTimer = setTimeout(run, 0);
    },

    runOfflineRenderStep () {
        if (!this.timeline.offlineRendering || !this.timeline.recording) return;
        try {
            // Runtime._step still owns all normal Scratch sequencing and the Movie BEFORE/AFTER hooks. The
            // difference is that the frame loop is stopped and this driver advances it only after the current
            // deterministic frame has finished, so the wall clock can never select or stretch a movie frame.
            this.runtime._step();
        } catch (error) {
            this.failOfflineRendering(error);
            return;
        }
        if (!this.timeline.offlineRendering || !this.timeline.recording) return;
        const promises = this.getOfflineRenderPromises();
        if (promises.length) {
            Promise.all(promises).then(
                () => this.scheduleOfflineRenderStep(),
                error => this.failOfflineRendering(error)
            );
        } else {
            this.scheduleOfflineRenderStep();
        }
    },

    completeOfflineRendering () {
        if (!this.timeline.offlineRendering) return;
        this.timeline.recording = false;
        this.timeline.playing = false;
        this.timeline.pendingFrame = false;
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.timeline.renderFrameThreads = [];
        this.setTimelineClock(this.getRenderEndTime(), true);
        this.runtime.stopAll();
        this.restorePreviewRendererSize();
        this.restoreOfflineRendering();
        this.emitTimelineChanged();
        this.emit('timelineRenderComplete', this.getTimelineState());
    },

    failOfflineRendering (error) {
        if (!this.timeline.offlineRendering) return;
        this.timeline.recording = false;
        this.timeline.playing = false;
        this.timeline.pendingFrame = false;
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.timeline.renderFrameThreads = [];
        this.runtime.stopAll();
        this.restorePreviewRendererSize();
        this.setTimelineClock(this.timeline.currentTime, true);
        this.restoreOfflineRendering();
        this.emitTimelineChanged();
        this.emit('renderError', error);
    },

    renderTimeline (options = {}) {
        this.cancelPenFrameTransaction();
        this.cancelPendingObjectDraws();
        this.playedTimelineSoundBlocks.clear();
        this.stopTimelineSounds();
        this.runtime.stopAll();
        const reuseFrames = options.reuseFrames === true;
        this.clearRenderingFrames({preserveCache: reuseFrames});
        this.resizeRendererForTimeline();
        const rangeStart = clamp(
            toNumber(options.start, this.timeline.rangeStart),
            0,
            this.timeline.duration
        );
        const rangeEnd = clamp(
            toNumber(options.end, this.timeline.rangeEnd || this.timeline.duration),
            rangeStart,
            this.timeline.duration
        );
        this.timeline.currentTime = rangeStart;
        this.timeline.pendingFrame = true;
        this.timeline.playing = false;
        this.timeline.recording = true;
        this.timeline.renderEndTime = rangeEnd;
        this.timeline.renderFrameIndex = Math.max(0, Math.ceil((rangeStart * this.timeline.framerate) - 1e-9));
        this.timeline.initializePromises = new Set();
        this.timeline.initializeThreads = [];
        this.timeline.initializing = true;
        this.timeline.renderFrameThreads = [];
        this.timeline.renderedThisStep = false;
        this.timeline.reuseFramesDuringRender = reuseFrames;
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        this.prepareOfflineRendering();
        this.setTimelineClock(this.timeline.renderFrameIndex / this.timeline.framerate, true);
        const initializeThreads = this.runtime.startHats('event_initialize');
        this.timeline.initializeThreads = Array.isArray(initializeThreads) ? initializeThreads : [];
        if (!this.timeline.initializeThreads.length && !this.timeline.initializePromises.size) {
            this.timeline.initializing = false;
        }
        this.emitTimelineChanged();
        this.scheduleOfflineRenderStep();
    },

    getRendererPixelRatio () {
        return typeof window !== 'undefined' && Number(window.devicePixelRatio) > 0 ?
            Number(window.devicePixelRatio) : 1;
    },

    resizeRendererForTimeline () {
        const renderer = this.runtime.renderer;
        if (!renderer || !renderer.canvas || typeof renderer.resize !== 'function') return;
        if (!this.previewRendererSize) {
            this.previewRendererSize = {
                height: renderer.canvas.height,
                width: renderer.canvas.width
            };
        }
        const pixelRatio = this.getRendererPixelRatio();
        renderer.resize(this.timeline.width / pixelRatio, this.timeline.height / pixelRatio);
    },

    restorePreviewRendererSize () {
        const renderer = this.runtime.renderer;
        const size = this.previewRendererSize;
        this.previewRendererSize = null;
        if (!size || !renderer || typeof renderer.resize !== 'function') return;
        const pixelRatio = this.getRendererPixelRatio();
        renderer.resize(size.width / pixelRatio, size.height / pixelRatio);
    },

    handleTimelineBeforeExecute () {
        this.beginFrameGraph();
        if (this.timeline.recording && this.timeline.initializing) {
            const hasInitializePromises = this.timeline.initializePromises instanceof Set &&
                this.timeline.initializePromises.size > 0;
            if (this.hasActiveInitializeThreads() || hasInitializePromises ||
                this.hasBlockingVideoRenders() || this.hasPendingVisualRenders()) return;
            this.timeline.initializeThreads = [];
            this.timeline.initializing = false;
        }
        if (this.timeline.waitingForFrame || this.timeline.waitingForVideo) {
            if (this.hasBlockingVideoRenders() || this.hasPendingVisualRenders()) return;
            // Continue the frame's existing threads after every slow visual operation has completed. Do not
            // restart the hat or advance the deterministic clock while the current frame is still being drawn.
            this.timeline.waitingForFrame = false;
            this.timeline.waitingForVideo = false;
            this.timeline.renderedThisStep = true;
            return;
        }
        if (!this.timeline.playing && !this.timeline.pendingFrame && !this.timeline.recording) return;
        if (this.timeline.recording) {
            this.setTimelineClock(
                Math.min(this.timeline.renderFrameIndex / this.timeline.framerate, this.getRenderEndTime()),
                true
            );
        } else if (this.timeline.playing) {
            const time = getTimelineClockTime(this.runtime.ioDevices.clock);
            this.timeline.currentTime = clamp(time, 0, this.timeline.duration);
            if (time >= this.timeline.duration) this.setTimelineClock(this.timeline.duration, false);
        }
        this.timeline.pendingFrame = false;
        this.timeline.renderedThisStep = true;
        if (this.timeline.recording && this.timeline.reuseFramesDuringRender &&
            this.renderingFrameCache instanceof Map) {
            const cachedFrame = this.renderingFrameCache.get(
                this.getRenderingFrameCacheKey(this.timeline.renderFrameIndex)
            );
            if (cachedFrame) {
                if (!Array.isArray(this.renderingFrames)) this.renderingFrames = [];
                if (!Array.isArray(this.renderingFrameNumbers)) this.renderingFrameNumbers = [];
                this.renderingFrames.push(cachedFrame);
                this.renderingFrameNumbers.push(this.timeline.renderFrameIndex);
                if (this.renderingSoundEventCache instanceof Map) {
                    const cachedEvents = this.renderingSoundEventCache.get(
                        this.getRenderingFrameCacheKey(this.timeline.renderFrameIndex)
                    ) || [];
                    for (const event of cachedEvents) {
                        this.renderingSoundEvents.push({...event});
                        if (event.dedupeKey) this.playedTimelineSoundBlocks.add(event.dedupeKey);
                    }
                }
                this.timeline.reusedFrameThisStep = true;
                this.emit('renderingFramesChanged', this.renderingFrames.length);
                return;
            }
        }
        this.beginObjectVideoAudioFrame();
        this.beginTimelineSoundFrame();
        this.resetPenForRenderFrame();
        const threads = this.runtime.startHats('event_renderframe');
        this.timeline.renderFrameThreads = Array.isArray(threads) ? threads : [];
    },

    handleTimelineAfterExecute () {
        this.flushFrameGraph();
        if (!this.timeline.renderedThisStep) return;
        this.timeline.renderedThisStep = false;
        const waitingForVideo = this.hasBlockingVideoRenders();
        if (waitingForVideo || this.hasPendingVisualRenders() || this.hasActiveRenderFrameThreads()) {
            this.timeline.waitingForFrame = true;
            this.timeline.waitingForVideo = waitingForVideo;
            return;
        }
        this.timeline.renderFrameThreads = [];
        this.timeline.waitingForFrame = false;
        this.timeline.waitingForVideo = false;
        if (!this.timeline.reusedFrameThisStep) {
            this.finishObjectVideoAudioFrame();
            this.finishTimelineSoundFrame();
            this.commitPenFrameTransaction();
        }
        if (this.timeline.recording) {
            if (!this.timeline.reusedFrameThisStep) {
                try {
                    this.addRenderingFrame();
                } catch (error) {
                    if (!Array.isArray(this.renderingFrameErrors)) this.renderingFrameErrors = [];
                    this.renderingFrameErrors.push({
                        frame: this.timeline.renderFrameIndex,
                        message: error && error.message ? error.message : String(error),
                        time: this.timeline.currentTime
                    });
                    this.timeline.recording = false;
                    this.timeline.playing = false;
                    this.restorePreviewRendererSize();
                    this.setTimelineClock(this.timeline.currentTime, true);
                    this.runtime.stopAll();
                    if (this.timeline.offlineRendering) {
                        this.restoreOfflineRendering();
                    }
                    this.emit('renderError', error);
                }
            }
            this.timeline.reusedFrameThisStep = false;
            if (this.timeline.recording && this.timeline.currentTime < this.getRenderEndTime()) {
                this.timeline.renderFrameIndex++;
                this.timeline.pendingFrame = true;
            }
        } else if (this.timeline.playing) {
            this.timeline.currentTime = clamp(
                getTimelineClockTime(this.runtime.ioDevices.clock),
                0,
                this.timeline.duration
            );
        }
        this.emitTimelineChanged();
        if (this.timeline.recording && this.timeline.currentTime >= this.getRenderEndTime()) {
            if (this.timeline.offlineRendering) {
                this.completeOfflineRendering();
                return;
            }
            const completedRendering = this.timeline.recording;
            this.timeline.recording = false;
            if (completedRendering) this.emit('timelineRenderComplete', this.getTimelineState());
        } else if (this.timeline.playing && this.timeline.currentTime >= this.getRenderEndTime()) {
            const completedRendering = this.timeline.recording;
            this.timeline.recording = false;
            this.pauseTimeline();
            if (completedRendering) this.emit('timelineRenderComplete', this.getTimelineState());
        }
    }
};

export default MovieAssetManagerTimelineMethods;
