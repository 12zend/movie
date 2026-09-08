const VIDEO_FRAME_RATE = 30;
const BITMAP_RESOLUTION = 2;
const TEXT_BITMAP_RESOLUTION = BITMAP_RESOLUTION * 8;
const RENDERING_DEFAULT_FRAME_RATE = 30;
const RENDERING_MAX_FRAME_RATE = 120;
const RENDERING_FILE_NAME = 'rendering.mp4';
const RENDERING_FORMATS = ['mp4', 'webm', 'png-sequence', 'png-frame', 'audio-wav'];
const RENDERING_MASTER_GAIN = 0.8912509381337456; // -1 dBFS headroom before encoding.
const TIMELINE_DEFAULT_DURATION = 10;
const TIMELINE_MAX_DURATION = 3600;
const KEYFRAME_TIME_EPSILON = 1e-9;
const DEFAULT_BACKDROP_ASSET_ID = 'cd21514d0531fdffb22204e0ec5ed84a';
const VIDEO_PROJECT_KEY = 'movieVideos';
const COSTUME_GROUP_PROJECT_KEY = 'movieCostumeGroups';
const COSTUME_GROUP_SOURCE = 'costume-group';
const MODEL_PROJECT_KEY = 'movieModels';
const CAMERA_PROJECT_KEY = 'movieCamera';
const TRANSFORM_PROJECT_KEY = 'movie3D';
const TIMELINE_PROJECT_KEY = 'movieTimeline';
const MIME_TYPES = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    ogv: 'video/ogg',
    webm: 'video/webm'
};

const IMPORT_MIME_TYPES = {
    aac: 'audio/aac',
    bmp: 'image/bmp',
    flac: 'audio/flac',
    gif: 'image/gif',
    jfif: 'image/jpeg',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    otf: 'font/otf',
    png: 'image/png',
    svg: 'image/svg+xml',
    wav: 'audio/wav',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2'
};

const COSTUME_EXTENSIONS = ['svg', 'png', 'bmp', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'exr'];
const SOUND_EXTENSIONS = ['wav', 'mp3', 'ogg', 'oga', 'flac', 'aac', 'm4a'];
const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'];
const MODEL_SOURCE_EXTENSIONS = ['glb', 'pmx', 'fbx', 'obj'];
const MOTION_EXTENSIONS = ['vmd', 'vpd'];

const MP4_VIDEO_MIME_TYPES = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1.4D401E',
    'video/mp4'
];

const MP4_AUDIO_MIME_TYPES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
    'video/mp4'
];

const WEBM_VIDEO_MIME_TYPES = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
];

const WEBM_AUDIO_MIME_TYPES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
];

export {
    BITMAP_RESOLUTION,
    TEXT_BITMAP_RESOLUTION,
    CAMERA_PROJECT_KEY,
    COSTUME_EXTENSIONS,
    COSTUME_GROUP_PROJECT_KEY,
    COSTUME_GROUP_SOURCE,
    DEFAULT_BACKDROP_ASSET_ID,
    FONT_EXTENSIONS,
    IMPORT_MIME_TYPES,
    KEYFRAME_TIME_EPSILON,
    MIME_TYPES,
    MODEL_PROJECT_KEY,
    MODEL_SOURCE_EXTENSIONS,
    MP4_AUDIO_MIME_TYPES,
    MP4_VIDEO_MIME_TYPES,
    MOTION_EXTENSIONS,
    RENDERING_DEFAULT_FRAME_RATE,
    RENDERING_FILE_NAME,
    RENDERING_FORMATS,
    RENDERING_MASTER_GAIN,
    RENDERING_MAX_FRAME_RATE,
    SOUND_EXTENSIONS,
    TIMELINE_DEFAULT_DURATION,
    TIMELINE_MAX_DURATION,
    TIMELINE_PROJECT_KEY,
    TRANSFORM_PROJECT_KEY,
    VIDEO_FRAME_RATE,
    VIDEO_PROJECT_KEY,
    WEBM_AUDIO_MIME_TYPES,
    WEBM_VIDEO_MIME_TYPES
};
