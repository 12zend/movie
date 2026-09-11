import EventEmitter from 'events';

import {
    COSTUME_GROUP_PROJECT_KEY,
    COSTUME_GROUP_SOURCE,
    VIDEO_FRAME_RATE,
    RENDERING_DEFAULT_FRAME_RATE,
    TIMELINE_DEFAULT_DURATION
} from './movie-asset-manager-constants';
import {
    DEFAULT_FOV,
    focalLengthFromFOV
} from './model-runtime';
import installMovieFrameGraphRenderer from './movie-frame-graph';

import MovieAssetManagerAssets from './movie-asset-manager-assets';
import MovieAssetManagerFrameGraph from './movie-asset-manager-frame-graph';
import MovieAssetManagerMedia from './movie-asset-manager-media';
import MovieAssetManagerModel from './movie-asset-manager-model';
import MovieAssetManagerObject from './movie-asset-manager-object';
import MovieAssetManagerPrimitives from './movie-asset-manager-primitives';
import MovieAssetManagerRenderExport from './movie-asset-manager-render-export';
import MovieAssetManagerSerialization from './movie-asset-manager-serialization';
import MovieAssetManagerSoundExport from './movie-asset-manager-sound-export';
import MovieAssetManagerTimeline from './movie-asset-manager-timeline';
import MovieAssetManagerTransform from './movie-asset-manager-transform';

class MovieAssetManager extends EventEmitter {
    constructor (vm) {
        super();
        this.vm = vm;
        this.runtime = vm.runtime;
        this.videos = new Map();
        this.costumeGroups = new Map();
        this.models = new Map();
        this.targetStates = new Map();
        this.fontFaces = new Map();
        this.modelObjects = new Map();
        this.objectImagePlanes = new Map();
        this.textCanvasCache = new Map();
        this.textCanvasCachePixels = 0;
        this.buildingPrimitiveCache = new Map();
        this.buildingMaterials = new Map();
        this.buildingTextures = new Map();
        this.shapeSkinCache = new Map();
        this.shapeSkinCachePixels = 0;
        this.blockingVideoRenders = new Set();
        this.renderingFrames = [];
        this.renderingFrameNumbers = [];
        this.renderingFrameErrors = [];
        this.renderingFrameCache = new Map();
        this.renderingSoundEventCache = new Map();
        this.renderCacheGeneration = 0;
        this.renderingSoundEvents = [];
        this.playedTimelineSoundBlocks = new Set();
        this.timelineSoundSources = new Set();
        this.timelineSoundPlaybacks = new Map();
        this.timelineSoundPlaybacksSeen = new Set();
        this.objectVideoAudio = new Map();
        this.objectVideoAudioSeen = new Set();
        this.previewRendererSize = null;
        this.modelRenderer = null;
        this.flatDepthVersion = 0;
        this.depthResourceGeneration = 0;
        this.frameGraphCollectionParents = [];
        this.frameGraphRenderPromise = null;
        this.lastFrameGraphWarnings = [];
        this.frameGraphWarningKeys = new Set();
        this.cameraVersion = 0;
        this.frameGraphCameraSnapshot = null;
        this.frameGraphCameraSnapshotVersion = -1;
        this.projectionBatchDepth = 0;
        this.penFrameTransactionActive = false;
        this.penFrameTransactionsInstalled = false;
        this.defaultStageBackgroundColor = null;
        // null selects the backwards-compatible studio lights; an array is the user-authored light scene.
        this.lights = null;
        const [stageWidth, stageHeight] = this.getStageSize();
        this.timeline = {
            currentTime: 0,
            duration: TIMELINE_DEFAULT_DURATION,
            exportFormat: 'mp4',
            framerate: RENDERING_DEFAULT_FRAME_RATE,
            height: stageHeight,
            initializePromises: new Set(),
            initializeThreads: [],
            initializing: false,
            keyframes: [],
            offlineRenderScheduled: false,
            offlineRenderTimer: null,
            offlineRendering: false,
            pendingFrame: true,
            playing: false,
            recording: false,
            rangeEnd: TIMELINE_DEFAULT_DURATION,
            rangeStart: 0,
            renderFrameThreads: [],
            reuseFrames: true,
            sound: '',
            waitingForFrame: false,
            waitingForVideo: false,
            width: stageWidth
        };
        this.camera = {
            fov: DEFAULT_FOV,
            focalLength: focalLengthFromFOV(DEFAULT_FOV, stageWidth, stageHeight),
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        };
        this.frameGraphRenderer = installMovieFrameGraphRenderer(
            this.runtime.renderer,
            graph => this.renderFrameGraph(graph)
        );

        this.handleTargetCreated = this.handleTargetCreated.bind(this);
        this.handleTargetRemoved = this.handleTargetRemoved.bind(this);
        this.handleFontsChanged = this.handleFontsChanged.bind(this);
        this.handleNativeSizeChanged = this.handleNativeSizeChanged.bind(this);
        this.handleProjectChanged = this.handleProjectChanged.bind(this);
        this.handleProjectLoaded = this.handleProjectLoaded.bind(this);
        this.handleTimelineBeforeExecute = this.handleTimelineBeforeExecute.bind(this);
        this.handleTimelineAfterExecute = this.handleTimelineAfterExecute.bind(this);
        this.stopAllObjectVideoAudio = this.stopAllObjectVideoAudio.bind(this);
        this.ensureMainTarget = this.ensureMainTarget.bind(this);

        this.runtime.on('targetWasCreated', this.handleTargetCreated);
        this.runtime.on('targetWasRemoved', this.handleTargetRemoved);
        this.runtime.fontManager.on('change', this.handleFontsChanged);
        this.runtime.on('BEFORE_EXECUTE', this.handleTimelineBeforeExecute);
        this.runtime.on('AFTER_EXECUTE', this.handleTimelineAfterExecute);
        this.runtime.on('PROJECT_CHANGED', this.handleProjectChanged);
        this.runtime.on('PROJECT_STOP_ALL', this.stopAllObjectVideoAudio);
        this.runtime.on('PROJECT_STOP_ALL', () => this.discardFrameGraph());
        this.runtime.on('PROJECT_LOADED', this.handleProjectLoaded);
        if (this.runtime.renderer && typeof this.runtime.renderer.on === 'function') {
            this.runtime.renderer.on('NativeSizeChanged', this.handleNativeSizeChanged);
        }
        this.runtime.targets.forEach(target => this.patchTarget(target));

        this.installPrimitives();
        this.installSerializationHooks();
        this.syncFontFaces();
        this.installTimelineHats();
        this.ensureMainTarget();
    }
}

const installMethods = methods => {
    Object.getOwnPropertyNames(methods).forEach(name => {
        const descriptor = Object.getOwnPropertyDescriptor(methods, name);
        descriptor.enumerable = false;
        Object.defineProperty(MovieAssetManager.prototype, name, descriptor);
    });
};

[
    MovieAssetManagerFrameGraph,
    MovieAssetManagerPrimitives,
    MovieAssetManagerTimeline,
    MovieAssetManagerSoundExport,
    MovieAssetManagerRenderExport,
    MovieAssetManagerAssets,
    MovieAssetManagerModel,
    MovieAssetManagerObject,
    MovieAssetManagerMedia,
    MovieAssetManagerTransform,
    MovieAssetManagerSerialization
].forEach(installMethods);

const installMovieAssetManager = vm => {
    if (!vm.__movieAssetManager) {
        vm.__movieAssetManager = new MovieAssetManager(vm);
        vm.runtime.movieAssetManager = vm.__movieAssetManager;
    }
    return vm.__movieAssetManager;
};

export {
    COSTUME_GROUP_PROJECT_KEY,
    COSTUME_GROUP_SOURCE,
    MovieAssetManager,
    VIDEO_FRAME_RATE,
    installMovieAssetManager as default
};
