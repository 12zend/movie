import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

import installMovieAssetManager from '../../lib/movie-asset-manager';
import {evaluateTimeScopes} from '../../lib/object-animation';

import {GearIcon, PauseIcon, PlayIcon, ZoomInIcon, ZoomOutIcon} from './icons.jsx';
import styles from './timeline.css';

const DEFAULT_PIXELS_PER_SECOND = 72;
const MIN_ZOOM_PERCENT = 5;
const MIN_PIXELS_PER_SECOND = DEFAULT_PIXELS_PER_SECOND * (MIN_ZOOM_PERCENT / 100);
const MAX_PIXELS_PER_SECOND = 320;
const ZOOM_FACTOR = 1.25;
const COMPACT_TIMELINE_WIDTH = 360;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const formatTime = seconds => {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remaining = safeSeconds - (minutes * 60);
    const minuteText = minutes < 10 ? `0${minutes}` : String(minutes);
    const secondText = remaining < 10 ? `0${remaining.toFixed(2)}` : remaining.toFixed(2);
    return `${minuteText}:${secondText}`;
};

const formatRulerTime = seconds => {
    if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60);
        const remaining = Number((seconds - (minutes * 60)).toFixed(1));
        const remainingText = Number.isInteger(remaining) ? String(remaining) : remaining.toFixed(1);
        return `${minutes}:${remaining < 10 ? '0' : ''}${remainingText}`;
    }
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
};

const getMajorTickStep = pixelsPerSecond => {
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    return steps.find(step => step * pixelsPerSecond >= 72) || steps[steps.length - 1];
};

class Timeline extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            draft: null,
            diagnostics: {ranges: [], warnings: []},
            exporting: false,
            exportError: '',
            pixelsPerSecond: DEFAULT_PIXELS_PER_SECOND,
            scrollLeft: 0,
            selectedKeyframeTime: null,
            settingsOpen: false,
            viewportWidth: 0,
            timeline: {
                currentTime: 0,
                duration: 10,
                frameCount: 0,
                framerate: props.framerate,
                height: props.customStageSize.height,
                keyframes: [],
                playing: false,
                recording: false,
                width: props.customStageSize.width
            }
        };
        this.handleTimelineChanged = this.handleTimelineChanged.bind(this);
        this.handleRenderingFramesChanged = this.handleRenderingFramesChanged.bind(this);
        this.handleTimelineDiagnosticsChanged = this.handleTimelineDiagnosticsChanged.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handlePlayPause = this.handlePlayPause.bind(this);
        this.handleStepFrame = this.handleStepFrame.bind(this);
        this.handleStop = this.handleStop.bind(this);
        this.handleToggleSettings = this.handleToggleSettings.bind(this);
        this.handleDraftChange = this.handleDraftChange.bind(this);
        this.handleSaveSettings = this.handleSaveSettings.bind(this);
        this.handleExport = this.handleExport.bind(this);
        this.handleMarkerMouseDown = this.handleMarkerMouseDown.bind(this);
        this.handleAddKeyframe = this.handleAddKeyframe.bind(this);
        this.handleDeleteKeyframe = this.handleDeleteKeyframe.bind(this);
        this.handleKeyframeClick = this.handleKeyframeClick.bind(this);
        this.handleRangeClick = this.handleRangeClick.bind(this);
        this.handleWarningClick = this.handleWarningClick.bind(this);
        this.handleRulerMouseDown = this.handleRulerMouseDown.bind(this);
        this.handleScrubEnd = this.handleScrubEnd.bind(this);
        this.handleScrubMove = this.handleScrubMove.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
        this.handleTimelineWheel = this.handleTimelineWheel.bind(this);
        this.handleZoomIn = this.handleZoomIn.bind(this);
        this.handleZoomOut = this.handleZoomOut.bind(this);
        this.measureTimelineViewport = this.measureTimelineViewport.bind(this);
    }

    componentDidMount () {
        this.unmounted = false;
        this.manager = installMovieAssetManager(this.props.vm);
        this.manager.on('timelineChanged', this.handleTimelineChanged);
        this.manager.on('renderingFramesChanged', this.handleRenderingFramesChanged);
        this.manager.on('timelineDiagnosticsChanged', this.handleTimelineDiagnosticsChanged);
        document.addEventListener('keydown', this.handleKeyDown);
        if (typeof ResizeObserver === 'function') {
            this.resizeObserver = new ResizeObserver(this.measureTimelineViewport);
            if (this.viewportElement) this.resizeObserver.observe(this.viewportElement);
        } else if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.measureTimelineViewport);
        }
        this.measureTimelineViewport();
        this.handleTimelineChanged(this.manager.getTimelineState());
        this.handleTimelineDiagnosticsChanged(this.manager.getTimelineDiagnostics(true));
    }

    componentDidUpdate (prevProps, prevState) {
        const timeline = this.state.timeline;
        if (timeline.playing && timeline.currentTime !== prevState.timeline.currentTime) {
            this.keepPlayheadVisible();
        }
    }

    componentWillUnmount () {
        this.unmounted = true;
        if (!this.manager) return;
        this.manager.removeListener('timelineChanged', this.handleTimelineChanged);
        this.manager.removeListener('renderingFramesChanged', this.handleRenderingFramesChanged);
        this.manager.removeListener('timelineDiagnosticsChanged', this.handleTimelineDiagnosticsChanged);
        document.removeEventListener('keydown', this.handleKeyDown);
        document.removeEventListener('mousemove', this.handleScrubMove);
        document.removeEventListener('mouseup', this.handleScrubEnd);
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this.measureTimelineViewport);
        }
    }

    measureTimelineViewport () {
        if (!this.viewportElement) return;
        const viewportWidth = this.viewportElement.clientWidth;
        if (viewportWidth !== this.state.viewportWidth) this.setState({viewportWidth});
    }

    handleTimelineChanged (timeline) {
        this.setState(state => {
            const keyframes = Array.isArray(timeline.keyframes) ? timeline.keyframes : [];
            const selectedStillExists = state.selectedKeyframeTime !== null && keyframes.some(time => (
                Math.abs(time - state.selectedKeyframeTime) <= 1e-9
            ));
            return {
                selectedKeyframeTime: selectedStillExists ? state.selectedKeyframeTime : null,
                timeline
            };
        });
    }

    handleRenderingFramesChanged (frameCount) {
        this.setState(state => ({
            timeline: Object.assign({}, state.timeline, {frameCount})
        }));
    }

    handleTimelineDiagnosticsChanged (diagnostics) {
        this.setState({
            diagnostics: diagnostics || {ranges: [], warnings: []}
        });
    }

    handleKeyDown (event) {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

        const isSpace = event.key === ' ' || event.code === 'Space';
        const isArrowLeft = event.key === 'ArrowLeft' || event.keyCode === 37;
        const isArrowRight = event.key === 'ArrowRight' || event.keyCode === 39;
        const isArrowDown = event.key === 'ArrowDown' || event.keyCode === 40;
        const isArrowUp = event.key === 'ArrowUp' || event.keyCode === 38;
        const isHome = event.key === 'Home' || event.keyCode === 36;
        const isEnd = event.key === 'End' || event.keyCode === 35;
        if (!isSpace && !isArrowLeft && !isArrowRight && !isArrowDown && !isArrowUp &&
            !isHome && !isEnd) return;

        const target = event.target;
        const tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
        const isTimelineTarget = Boolean(
            this.timelineElement && target && this.timelineElement.contains(target)
        );
        const isTimelineScrubber = isTimelineTarget && target === this.scrubberElement;
        const isFormControl = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
        const isInteractiveControl = isFormControl || tagName === 'button' || tagName === 'a';
        const isEditingText = (isFormControl && !isTimelineScrubber) || (target && target.isContentEditable);

        if (isSpace) {
            if (event.repeat || isEditingText || (isInteractiveControl && !isTimelineScrubber)) return;
            event.preventDefault();
            this.handlePlayPause();
            return;
        }

        const hasNoFocusedControl = !target || target === document || target === document.body;
        if (this.state.timeline.recording || isEditingText ||
            (!hasNoFocusedControl && !isTimelineScrubber)) return;
        event.preventDefault();
        if (isHome || isEnd) {
            this.manager.seekTimeline(isHome ? 0 : this.state.timeline.duration);
        } else {
            this.handleStepFrame(isArrowLeft || isArrowDown ? -1 : 1);
        }
    }

    handlePlayPause () {
        if (this.state.timeline.playing) {
            this.manager.pauseTimeline();
        } else {
            this.manager.playTimeline();
        }
    }

    handleStepFrame (direction) {
        const timeline = this.state.timeline;
        const framerate = Math.max(1, Number(timeline.framerate) || 1);
        const currentFrame = Math.round(timeline.currentTime * framerate);
        const nextTime = (currentFrame + direction) / framerate;
        this.manager.seekTimeline(Math.max(0, Math.min(timeline.duration, nextTime)));
    }

    handleStop () {
        this.manager.stopTimeline();
    }

    seekFromClientX (clientX) {
        if (!this.viewportElement) return;
        const rect = this.viewportElement.getBoundingClientRect();
        const contentX = this.viewportElement.scrollLeft + clientX - rect.left;
        const time = clamp(
            contentX / this.state.pixelsPerSecond,
            0,
            this.state.timeline.duration
        );
        this.manager.seekTimeline(time);
    }

    handleRulerMouseDown (event) {
        if (event.button !== 0 || this.state.timeline.recording) return;
        event.preventDefault();
        this.scrubbing = true;
        this.seekFromClientX(event.clientX);
        document.addEventListener('mousemove', this.handleScrubMove);
        document.addEventListener('mouseup', this.handleScrubEnd);
    }

    handleScrubMove (event) {
        if (!this.scrubbing) return;
        event.preventDefault();
        this.seekFromClientX(event.clientX);
    }

    handleScrubEnd () {
        this.scrubbing = false;
        document.removeEventListener('mousemove', this.handleScrubMove);
        document.removeEventListener('mouseup', this.handleScrubEnd);
    }

    handleAddKeyframe () {
        const time = this.state.timeline.currentTime;
        this.manager.addTimelineKeyframe(time);
        this.setState({selectedKeyframeTime: time});
    }

    handleDeleteKeyframe () {
        const keyframes = Array.isArray(this.state.timeline.keyframes) ? this.state.timeline.keyframes : [];
        if (this.state.selectedKeyframeTime === null) return;
        const index = keyframes.findIndex(time => (
            Math.abs(time - this.state.selectedKeyframeTime) <= 1e-9
        ));
        if (index < 0) return;
        this.manager.removeTimelineKeyframe(index + 1);
        this.setState({selectedKeyframeTime: null});
    }

    handleKeyframeClick (event) {
        event.stopPropagation();
        const time = Number(event.currentTarget.value);
        this.setState({selectedKeyframeTime: time});
        this.manager.seekTimeline(time);
    }

    handleRangeClick (event) {
        event.stopPropagation();
        const index = Number(event.currentTarget.value);
        const range = this.state.diagnostics.ranges[index];
        if (range) this.manager.emit('focusMovieBlock', range);
    }

    handleWarningClick (event) {
        const warning = this.state.diagnostics.warnings[Number(event.currentTarget.value)];
        if (warning) this.manager.emit('focusMovieBlock', warning);
    }

    handleMarkerMouseDown (event) {
        event.stopPropagation();
    }

    handleScroll (event) {
        const scrollLeft = event.currentTarget.scrollLeft;
        if (Math.abs(scrollLeft - this.state.scrollLeft) > 0.5) this.setState({scrollLeft});
    }

    handleTimelineWheel (event) {
        if (!this.viewportElement) return;
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            this.setZoom(
                this.state.pixelsPerSecond * (event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR),
                event.clientX
            );
            return;
        }
        const hasVerticalOverflow =
            this.viewportElement.scrollHeight > this.viewportElement.clientHeight;
        if (hasVerticalOverflow) return;
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            event.preventDefault();
            this.viewportElement.scrollLeft += event.deltaY;
        }
    }

    setZoom (pixelsPerSecond, anchorClientX) {
        if (!this.viewportElement) return;
        const nextPixelsPerSecond = clamp(
            pixelsPerSecond,
            MIN_PIXELS_PER_SECOND,
            MAX_PIXELS_PER_SECOND
        );
        if (nextPixelsPerSecond === this.state.pixelsPerSecond) return;
        const rect = this.viewportElement.getBoundingClientRect();
        const anchorOffset = Number.isFinite(anchorClientX) ?
            clamp(anchorClientX - rect.left, 0, rect.width) : rect.width / 2;
        const anchorTime = (this.viewportElement.scrollLeft + anchorOffset) /
            this.state.pixelsPerSecond;
        this.setState({pixelsPerSecond: nextPixelsPerSecond}, () => {
            this.viewportElement.scrollLeft = (anchorTime * nextPixelsPerSecond) - anchorOffset;
        });
    }

    handleZoomIn () {
        this.setZoom(this.state.pixelsPerSecond * ZOOM_FACTOR);
    }

    handleZoomOut () {
        this.setZoom(this.state.pixelsPerSecond / ZOOM_FACTOR);
    }

    keepPlayheadVisible () {
        if (!this.viewportElement) return;
        const playheadX = this.state.timeline.currentTime * this.state.pixelsPerSecond;
        const left = this.viewportElement.scrollLeft;
        const right = left + this.viewportElement.clientWidth;
        const padding = Math.min(48, this.viewportElement.clientWidth * 0.15);
        if (playheadX < left + padding) {
            this.viewportElement.scrollLeft = Math.max(0, playheadX - padding);
        } else if (playheadX > right - padding) {
            this.viewportElement.scrollLeft = playheadX - this.viewportElement.clientWidth + padding;
        }
    }

    getRulerTicks () {
        const pixelsPerSecond = this.state.pixelsPerSecond;
        const majorStep = getMajorTickStep(pixelsPerSecond);
        const divisions = 5;
        const minorStep = majorStep / divisions;
        const fallbackWidth = Math.min(
            this.state.timeline.duration * pixelsPerSecond,
            800
        );
        const viewportWidth = this.state.viewportWidth || fallbackWidth;
        const visibleStart = Math.max(0, this.state.scrollLeft / pixelsPerSecond);
        const visibleEnd = Math.min(
            this.state.timeline.duration,
            (this.state.scrollLeft + viewportWidth) / pixelsPerSecond
        );
        const firstIndex = Math.max(0, Math.floor(visibleStart / minorStep) - 1);
        const lastIndex = Math.ceil(visibleEnd / minorStep) + 1;
        const ticks = [];
        for (let index = firstIndex; index <= lastIndex; index++) {
            const time = Number((index * minorStep).toFixed(6));
            if (time > this.state.timeline.duration) break;
            ticks.push({
                major: index % divisions === 0,
                time
            });
        }
        return ticks;
    }

    handleToggleSettings () {
        this.setState(state => {
            if (state.settingsOpen) return {settingsOpen: false};
            return {
                draft: Object.assign({}, state.timeline),
                settingsOpen: true
            };
        });
    }

    handleDraftChange (event) {
        const property = event.target.name;
        const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
        const presets = {
            'preview-720': {framerate: 24, height: 720, width: 1280},
            'final-1080': {framerate: 30, height: 1080, width: 1920},
            'final-4k': {framerate: 30, height: 2160, width: 3840}
        };
        this.setState(state => ({
            draft: Object.assign({}, state.draft, {[property]: value}, property === 'preset' ? presets[value] : null)
        }));
    }

    handleSaveSettings () {
        const draft = this.state.draft;
        this.manager.updateTimelineSettings({
            duration: Number(draft.duration),
            exportFormat: draft.exportFormat,
            framerate: Number(draft.framerate),
            height: Number(draft.height),
            rangeEnd: Number(draft.rangeEnd),
            rangeStart: Number(draft.rangeStart),
            reuseFrames: draft.reuseFrames,
            width: Number(draft.width)
        });
        this.setState({settingsOpen: false});
    }

    handleExport () {
        const settings = this.state.draft || this.state.timeline;
        this.manager.updateTimelineSettings({
            duration: Number(settings.duration),
            exportFormat: settings.exportFormat,
            framerate: Number(settings.framerate),
            height: Number(settings.height),
            rangeEnd: Number(settings.rangeEnd),
            rangeStart: Number(settings.rangeStart),
            reuseFrames: settings.reuseFrames,
            width: Number(settings.width)
        });
        this.setState({exportError: '', exporting: true});
        const finish = error => {
            if (!this.unmounted) {
                this.setState({
                    exportError: error && error.message ? error.message : '',
                    exporting: false
                });
            }
        };
        const singleFrame = settings.exportFormat === 'png-frame';
        return this.manager.renderAndExportTimeline({
            end: singleFrame ? this.state.timeline.currentTime : Number(settings.rangeEnd),
            format: settings.exportFormat,
            reuseFrames: settings.reuseFrames === true,
            start: singleFrame ? this.state.timeline.currentTime : Number(settings.rangeStart)
        }).then(() => finish(), finish);
    }

    renderSettings () {
        if (!this.state.settingsOpen || !this.state.draft) return null;
        return (
            <div className={styles.settingsPanel}>
                <div className={styles.settingsHeading}>
                    <div>
                        <strong>{'Rendering settings'}</strong>
                        <span>
                            {'The stage stays at '}
                            {this.props.customStageSize.width}{'×'}{this.props.customStageSize.height}
                            {'; output size only changes image detail.'}
                        </span>
                    </div>
                    <button
                        aria-label="Close rendering settings"
                        className={styles.closeButton}
                        type="button"
                        onClick={this.handleToggleSettings}
                    >{'×'}</button>
                </div>
                <div className={styles.settingsGrid}>
                    <label>
                        <span>{'Render preset'}</span>
                        <select
                            name="preset"
                            value={this.state.draft.preset || 'custom'}
                            onChange={this.handleDraftChange}
                        >
                            <option value="custom">{'Custom'}</option>
                            <option value="preview-720">{'Preview · 720p / 24'}</option>
                            <option value="final-1080">{'Final · 1080p / 30'}</option>
                            <option value="final-4k">{'Final · 4K / 30'}</option>
                        </select>
                    </label>
                    <label>
                        <span>{'Export format'}</span>
                        <select
                            name="exportFormat"
                            value={this.state.draft.exportFormat || 'mp4'}
                            onChange={this.handleDraftChange}
                        >
                            <option value="mp4">{'MP4 video'}</option>
                            <option value="webm">{'Transparent WebM'}</option>
                            <option value="png-sequence">{'PNG sequence (.zip)'}</option>
                            <option value="png-frame">{'Current frame PNG'}</option>
                            <option value="audio-wav">{'Audio only (WAV)'}</option>
                        </select>
                    </label>
                    <label>
                        <span>{'Output width'}</span>
                        <input
                            max="4096"
                            min="1"
                            name="width"
                            type="number"
                            value={this.state.draft.width}
                            onChange={this.handleDraftChange}
                        />
                    </label>
                    <label>
                        <span>{'Output height'}</span>
                        <input
                            max="4096"
                            min="1"
                            name="height"
                            type="number"
                            value={this.state.draft.height}
                            onChange={this.handleDraftChange}
                        />
                    </label>
                    <label>
                        <span>{'Frame rate'}</span>
                        <input
                            max="120"
                            min="1"
                            name="framerate"
                            step="1"
                            type="number"
                            value={this.state.draft.framerate}
                            onChange={this.handleDraftChange}
                        />
                    </label>
                    <label>
                        <span>{'Max time (sec)'}</span>
                        <input
                            max="3600"
                            min="0.1"
                            name="duration"
                            step="0.1"
                            type="number"
                            value={this.state.draft.duration}
                            onChange={this.handleDraftChange}
                        />
                    </label>
                    <label>
                        <span>{'Range start (sec)'}</span>
                        <input
                            max={this.state.draft.duration}
                            min="0"
                            name="rangeStart"
                            step="0.01"
                            type="number"
                            value={this.state.draft.rangeStart}
                            onChange={this.handleDraftChange}
                        />
                    </label>
                    <label>
                        <span>{'Range end (sec)'}</span>
                        <input
                            max={this.state.draft.duration}
                            min={this.state.draft.rangeStart}
                            name="rangeEnd"
                            step="0.01"
                            type="number"
                            value={this.state.draft.rangeEnd}
                            onChange={this.handleDraftChange}
                        />
                    </label>
                    <label className={styles.checkboxLabel}>
                        <input
                            checked={this.state.draft.reuseFrames !== false}
                            name="reuseFrames"
                            type="checkbox"
                            onChange={this.handleDraftChange}
                        />
                        <span>{'Reuse unchanged frames and resume partial renders'}</span>
                    </label>
                </div>
                {this.state.exportError ? (
                    <p className={styles.exportError}>{this.state.exportError}</p>
                ) : null}
                <div className={styles.settingsActions}>
                    <button
                        className={styles.secondaryButton}
                        disabled={
                            this.state.timeline.recording ||
                            this.state.exporting
                        }
                        type="button"
                        onClick={this.handleExport}
                    >{this.state.timeline.recording && this.state.exporting ? 'Rendering…' :
                            (this.state.exporting ? 'Exporting…' :
                                (this.state.timeline.frameCount && this.state.draft.reuseFrames !== false ?
                                    'Resume / export' : 'Render / export'))}</button>
                    <button
                        className={styles.primaryButton}
                        disabled={this.state.timeline.recording || this.state.exporting}
                        type="button"
                        onClick={this.handleSaveSettings}
                    >{'Apply'}</button>
                </div>
            </div>
        );
    }

    render () {
        const timeline = this.state.timeline;
        const timelineWidth = Math.max(
            timeline.duration * this.state.pixelsPerSecond,
            Math.max(1, this.state.viewportWidth - 2)
        );
        const rulerTicks = this.getRulerTicks();
        const zoomPercent = Math.round(
            (this.state.pixelsPerSecond / DEFAULT_PIXELS_PER_SECOND) * 100
        );
        const diagnosticRanges = (this.state.diagnostics.ranges || []).filter(range => (
            range.end >= 0 && range.start <= timeline.duration
        ));
        const warnings = this.state.diagnostics.warnings || [];
        const keyframes = Array.isArray(timeline.keyframes) ? timeline.keyframes : [];
        const laneHeight = 22;
        const timelineCanvasHeight = Math.max(68, 38 + (diagnosticRanges.length * laneHeight));
        return (
            <section
                aria-label="Timeline"
                className={classNames(styles.timeline, {
                    [styles.isCompact]: this.state.viewportWidth > 0 &&
                        this.state.viewportWidth < COMPACT_TIMELINE_WIDTH
                })}
                ref={element => {
                    this.timelineElement = element;
                }}
            >
                {this.renderSettings()}
                <div className={styles.header}>
                    <div className={styles.headerLeading}>
                        <div
                            aria-label="Timeline playback"
                            className={styles.playbackControls}
                            data-movie-timeline-playback
                            role="group"
                        >
                            <button
                                aria-label={timeline.playing ? 'Pause' : 'Play'}
                                className={styles.playButton}
                                title={timeline.playing ? 'Pause (Space)' : 'Play (Space)'}
                                type="button"
                                onClick={this.handlePlayPause}
                            >{timeline.playing ? <PauseIcon /> : <PlayIcon />}</button>
                            <button
                                aria-label="Stop and return to start"
                                className={styles.stopButton}
                                type="button"
                                onClick={this.handleStop}
                            ><span /></button>
                        </div>

                    </div>
                    <div className={styles.headerActions}>
                        <div
                            className={styles.addonControls}
                            data-movie-timeline-addons
                        />
                        <output
                            aria-live="off"
                            className={styles.timecode}
                        >
                            {formatTime(timeline.currentTime)} <span>{'/ '}{formatTime(timeline.duration)}</span>
                        </output>
                        <button
                            aria-expanded={this.state.settingsOpen}
                            className={classNames(styles.iconButton, {
                                [styles.isActive]: this.state.settingsOpen
                            })}
                            disabled={timeline.recording}
                            title="Rendering settings"
                            type="button"
                            onClick={this.handleToggleSettings}
                        ><GearIcon /></button>
                    </div>
                </div>
                <div className={styles.scrubber}>
                    <div
                        className={styles.timelineViewport}
                        onScroll={this.handleScroll}
                        onWheel={this.handleTimelineWheel}
                        ref={element => {
                            this.viewportElement = element;
                        }}
                    >
                        <div
                            className={styles.timelineCanvas}
                            style={{height: `${timelineCanvasHeight}px`, width: `${timelineWidth}px`}}
                        >
                            <div
                                aria-hidden="true"
                                className={styles.ruler}
                                onMouseDown={this.handleRulerMouseDown}
                            >
                                {rulerTicks.map(tick => (
                                    <span
                                        className={classNames(styles.rulerTick, {
                                            [styles.majorTick]: tick.major,
                                            [styles.originTick]: tick.time === 0
                                        })}
                                        key={tick.time}
                                        style={{left: `${tick.time * this.state.pixelsPerSecond}px`}}
                                    >
                                        {tick.major ? <span>{formatRulerTime(tick.time)}</span> : null}
                                    </span>
                                ))}
                            </div>
                            <div
                                aria-label="Code-derived active ranges"
                                className={styles.codeRanges}
                            >
                                {diagnosticRanges.map((range, index) => {
                                    const start = clamp(range.start, 0, timeline.duration);
                                    const end = clamp(range.end, start, timeline.duration);
                                    const active = timeline.currentTime >= start && timeline.currentTime <= end;
                                    const localTime = Array.isArray(range.timeScopes) ?
                                        evaluateTimeScopes(timeline.currentTime, range.timeScopes) :
                                        (Number.isFinite(range.localTime) ?
                                            range.localTime : timeline.currentTime - start);
                                    const hiddenReason = timeline.currentTime < start ?
                                        `Starts at ${formatTime(start)}` :
                                        (timeline.currentTime > end ? `Ended at ${formatTime(end)}` :
                                            `Local time ${localTime.toFixed(2)}s`);
                                    const width = Math.max(2, (end - start) * this.state.pixelsPerSecond);
                                    const rangeAriaLabel = `${range.label}, ${formatTime(start)} to ${formatTime(end)}`;
                                    const rangeKey = `${range.targetId}:${range.blockId}:${index}`;
                                    const rangeTitle = `${range.label} · ${hiddenReason} · Click to show block`;
                                    const localTimeLabel = `${localTime.toFixed(2)}s`;
                                    return (
                                        <button
                                            aria-label={rangeAriaLabel}
                                            className={classNames(styles.codeRange, styles[range.kind], {
                                                [styles.isActiveRange]: active
                                            })}
                                            key={rangeKey}
                                            style={{
                                                left: `${start * this.state.pixelsPerSecond}px`,
                                                top: `${36 + (index * laneHeight)}px`,
                                                width: `${width}px`
                                            }}
                                            title={rangeTitle}
                                            type="button"
                                            value={this.state.diagnostics.ranges.indexOf(range)}
                                            onClick={this.handleRangeClick}
                                            onMouseDown={this.handleMarkerMouseDown}
                                        >
                                            <span>{range.label}</span>
                                            {active && width > 108 ? <small>{localTimeLabel}</small> : null}
                                        </button>
                                    );
                                })}
                            </div>
                            <div
                                aria-label="Timeline keyframes"
                                className={styles.keyframeMarkers}
                            >
                                {keyframes.map((time, index) => {
                                    const selected = this.state.selectedKeyframeTime !== null &&
                                        Math.abs(time - this.state.selectedKeyframeTime) <= 1e-9;
                                    const label = `Keyframe ${index + 1}, ${formatTime(time)}`;
                                    return (
                                        <button
                                            aria-label={label}
                                            aria-pressed={selected}
                                            className={classNames(styles.keyframeMarker, {
                                                [styles.atEndKeyframe]: time === timeline.duration,
                                                [styles.atOriginKeyframe]: time === 0,
                                                [styles.isSelectedKeyframe]: selected
                                            })}
                                            key={time}
                                            style={{left: `${time * this.state.pixelsPerSecond}px`}}
                                            title={[label, 'Click to select and seek'].join(' · ')}
                                            type="button"
                                            value={time}
                                            onClick={this.handleKeyframeClick}
                                            onMouseDown={this.handleMarkerMouseDown}
                                        ><span><small>{index + 1}</small></span></button>
                                    );
                                })}
                            </div>
                            <div
                                aria-disabled={timeline.recording}
                                aria-label="Current timeline position"
                                aria-valuemax={timeline.duration}
                                aria-valuemin="0"
                                aria-valuenow={timeline.currentTime}
                                aria-valuetext={formatTime(timeline.currentTime)}
                                className={classNames(styles.timelineTrack, {
                                    [styles.isDisabled]: timeline.recording
                                })}
                                role="slider"
                                tabIndex={timeline.recording ? -1 : 0}
                                onMouseDown={this.handleRulerMouseDown}
                                ref={element => {
                                    this.scrubberElement = element;
                                }}
                            >
                                <span
                                    aria-hidden="true"
                                    className={styles.elapsedRange}
                                    style={{width: `${timeline.currentTime * this.state.pixelsPerSecond}px`}}
                                />
                            </div>
                            <div
                                aria-hidden="true"
                                className={classNames(styles.playhead, {
                                    [styles.atOrigin]: timeline.currentTime === 0,
                                    [styles.atEnd]: timeline.currentTime === timeline.duration
                                })}
                                style={{left: `${timeline.currentTime * this.state.pixelsPerSecond}px`}}
                            ><span /></div>
                        </div>
                    </div>
                </div>
                <div className={styles.transport}>
                    <span className={styles.status}>
                        {timeline.recording ? (timeline.playing ? 'Rendering' : 'Render paused') :
                            'keyframe'}
                    </span>
                    <div
                        aria-label="Keyframe controls"
                        className={styles.keyframeControls}
                        role="group"
                    >
                        <button
                            disabled={timeline.recording}
                            title={`Add a keyframe at ${formatTime(timeline.currentTime)}`}
                            type="button"
                            onClick={this.handleAddKeyframe}
                        >{'+'}</button>
                        <button
                            disabled={timeline.recording || this.state.selectedKeyframeTime === null}
                            title="Delete the selected keyframe"
                            type="button"
                            onClick={this.handleDeleteKeyframe}
                        >{'-'}</button>
                    </div>
                    <div
                        aria-label="Timeline zoom"
                        className={styles.zoomControls}
                        role="group"
                    >
                        <button
                            aria-label="Zoom out timeline"
                            className={styles.zoomButton}
                            disabled={this.state.pixelsPerSecond <= MIN_PIXELS_PER_SECOND}
                            title="Zoom out"
                            type="button"
                            onClick={this.handleZoomOut}
                        ><ZoomOutIcon /></button>
                        <span
                            className={styles.zoomLevel}
                        >{zoomPercent}{'%'}</span>
                        <button
                            aria-label="Zoom in timeline"
                            className={styles.zoomButton}
                            disabled={this.state.pixelsPerSecond >= MAX_PIXELS_PER_SECOND}
                            title="Zoom in"
                            type="button"
                            onClick={this.handleZoomIn}
                        ><ZoomInIcon /></button>
                    </div>
                </div>
                {warnings.length ? (
                    <div
                        aria-label="Frame determinism warnings"
                        className={styles.diagnostics}
                        role="status"
                    >
                        <strong>{'Direct seeking may differ'}</strong>
                        {warnings.slice(0, 2).map((warning, index) => {
                            const warningKey = `${warning.targetId}:${warning.blockId}:${index}`;
                            return (
                                <button
                                    key={warningKey}
                                    title={warning.message}
                                    type="button"
                                    value={this.state.diagnostics.warnings.indexOf(warning)}
                                    onClick={this.handleWarningClick}
                                >{warning.message}</button>
                            );
                        })}
                        {warnings.length > 2 ? <span>{`+${warnings.length - 2} more`}</span> : null}
                    </div>
                ) : null}
            </section>
        );
    }
}

Timeline.propTypes = {
    customStageSize: PropTypes.shape({
        height: PropTypes.number.isRequired,
        width: PropTypes.number.isRequired
    }).isRequired,
    framerate: PropTypes.number.isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};

export {Timeline};
export default Timeline;
