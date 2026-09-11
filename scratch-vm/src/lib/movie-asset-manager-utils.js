import {
    BITMAP_RESOLUTION,
    IMPORT_MIME_TYPES,
    KEYFRAME_TIME_EPSILON,
    TIMELINE_DEFAULT_DURATION
} from './movie-asset-manager-constants';
import {ROTATION_ORDERS} from './model-runtime';

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const canvasToBlob = (canvas, type = 'image/png') => new Promise((resolve, reject) => {
    if (!canvas) {
        reject(new Error('Rendering frame is not available.'));
        return;
    }
    if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('Could not encode the rendering frame.'));
        }, type);
        return;
    }
    try {
        const dataUrl = canvas.toDataURL(type);
        const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        resolve(new Blob([bytes], {type}));
    } catch (error) {
        reject(error);
    }
});

const now = () => (
    typeof performance !== 'undefined' && typeof performance.now === 'function' ?
        performance.now() : Date.now()
);

const copyArrayBuffer = data => {
    if (data instanceof ArrayBuffer) return data.slice(0);
    if (ArrayBuffer.isView(data)) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
    return data;
};

const readFile = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
});

const once = (element, successEvent, errorEvent = 'error') => new Promise((resolve, reject) => {
    const cleanup = () => {
        // eslint-disable-next-line no-use-before-define
        element.removeEventListener(successEvent, handleSuccess);
        // eslint-disable-next-line no-use-before-define
        element.removeEventListener(errorEvent, handleError);
    };
    const handleSuccess = () => {
        cleanup();
        resolve();
    };
    const handleError = () => {
        cleanup();
        reject(element.error || new Error('Could not decode the media file.'));
    };
    element.addEventListener(successEvent, handleSuccess);
    element.addEventListener(errorEvent, handleError);
});

const getVideoMetadata = async url => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.src = url;
    await once(video, 'loadedmetadata');
    const metadata = {
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight
    };
    video.removeAttribute('src');
    video.load();
    return metadata;
};

const getExtension = fileName => {
    const parts = fileName.toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
};

const getName = fileName => fileName.replace(/\.[^.]+$/, '') || 'video';

const getImportMimeType = file => file.type || IMPORT_MIME_TYPES[getExtension(file.name)] || '';

const normalizeImportError = error => (
    error instanceof Error ? error : new Error(String(error))
);

const MODEL_TEXTURE_FORMATS = ['bmp', 'gif', 'jpeg', 'jpg', 'png', 'spa', 'sph', 'tga', 'webp'];
const MODEL_SUPPORT_EXTENSIONS = ['mtl'].concat(MODEL_TEXTURE_FORMATS);

const getUploadPath = file => String(file.webkitRelativePath || file.name).replace(/\\/g, '/');

const getModelResourcePath = (file, modelFile) => {
    const path = getUploadPath(file);
    const modelPath = getUploadPath(modelFile);
    const separator = modelPath.lastIndexOf('/');
    if (separator < 0) return path;
    const modelDirectory = modelPath.slice(0, separator + 1);
    return path.toLowerCase().startsWith(modelDirectory.toLowerCase()) ?
        path.slice(modelDirectory.length) : path;
};

const unusedName = (requestedName, usedNames) => {
    const base = requestedName || 'video';
    const lowerNames = usedNames.map(name => name.toLowerCase());
    if (!lowerNames.includes(base.toLowerCase())) return base;
    let index = 2;
    while (lowerNames.includes(`${base}${index}`.toLowerCase())) index++;
    return `${base}${index}`;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getOriginalTarget = target => {
    if (!target || target.isOriginal || !target.sprite || !target.sprite.clones) return target;
    return target.sprite.clones.find(clone => clone.isOriginal) || target;
};

const getCostumeAssetId = costume => (
    typeof costume === 'string' ? costume : costume && (costume.assetId || costume.name)
);

const normalizeCostumeGroup = (group, fallbackName = 'Costume group') => {
    const source = group || {};
    const members = Array.isArray(source.costumeAssetIds) ? source.costumeAssetIds : source.costumes;
    const costumeAssetIds = Array.from(new Set(
        (Array.isArray(members) ? members : [])
            .map(getCostumeAssetId)
            .filter(Boolean)
            .map(String)
    ));
    return {
        costumeAssetIds,
        name: String(source.name || fallbackName)
    };
};

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const normalizeTimelineKeyframes = (keyframes, duration = TIMELINE_DEFAULT_DURATION) => {
    const maximum = Math.max(0, toNumber(duration, TIMELINE_DEFAULT_DURATION));
    return (Array.isArray(keyframes) ? keyframes : [])
        .map(time => clamp(toNumber(time, NaN), 0, maximum))
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
        .filter((time, index, result) => (
            index === 0 || Math.abs(time - result[index - 1]) > KEYFRAME_TIME_EPSILON
        ));
};

const normalizeRotationOrder = value => {
    const order = String(value || '').toUpperCase();
    return ROTATION_ORDERS.includes(order) ? order : 'XYZ';
};

// Shared time-window gate for object and shape draws. Missing bounds stay unbounded.
const isWithinTimeWindow = (timeWindow, currentTime) => {
    if (!timeWindow) return true;
    const startTime = toNumber(timeWindow.start, Number.NEGATIVE_INFINITY);
    const endTime = toNumber(timeWindow.end, Number.POSITIVE_INFINITY);
    return currentTime >= startTime && currentTime <= endTime;
};

const normalizeScale = (value, fallback = 1) => Math.max(0, toNumber(value, fallback));

const SHAPE_TYPES = ['polygon', 'star', 'curved star', 'flower'];
const PROCEDURAL_SHAPE_TYPES = SHAPE_TYPES.concat(['arc', 'circular segment', 'line']);
const MAX_SHAPE_SIZE = 4096;
const MAX_SHAPE_BITMAP_PIXELS = 1024 * 1024;
const SHAPE_RADIUS_SCALE = 0.5;
const DEFAULT_SHAPE_RATIO = 0.5;
const MAX_CACHED_SHAPE_SKINS = 256;
const MAX_CACHED_SHAPE_SKIN_PIXELS = 4096 * 4096;

const normalizeShapeType = value => {
    const shape = String(value || '').toLowerCase();
    return PROCEDURAL_SHAPE_TYPES.includes(shape) ? shape : SHAPE_TYPES[0];
};

const normalizeShapeRatio = value => clamp(toNumber(value, DEFAULT_SHAPE_RATIO), 0, 1);

const getShapeBitmapCacheKey = configuration => {
    const shape = normalizeShapeType(configuration.shape);
    const color = typeof configuration.color === 'string' && configuration.color ?
        configuration.color : '#ffffff';
    const opacity = clamp(toNumber(configuration.opacity, 100), 0, 100);
    if (shape === 'line') {
        const point1 = configuration.position1 || {};
        const point2 = configuration.position2 || {};
        return JSON.stringify([
            shape,
            toNumber(point2.x) - toNumber(point1.x),
            toNumber(point2.y) - toNumber(point1.y),
            Math.max(0.001, Math.abs(toNumber(configuration.thickness, 5))),
            color,
            opacity
        ]);
    }

    const radius = configuration.radius || {};
    const outerRadius = Math.min(
        MAX_SHAPE_SIZE,
        Math.max(0.001, Math.abs(toNumber(
            shape === 'circular segment' ? configuration.size : radius.outer, 100
        )))
    );
    const innerRadius = Math.min(
        outerRadius,
        Math.max(0, Math.abs(toNumber(
            shape === 'circular segment' ? 0 : radius.inner,
            shape === 'circular segment' ? 0 : outerRadius * 0.5
        )))
    );
    const ratio = shape === 'star' || shape === 'curved star' || shape === 'flower' ?
        normalizeShapeRatio(configuration.ratio) : null;
    const angle = configuration.angle || {};
    return JSON.stringify([
        shape,
        Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.round(Math.abs(toNumber(configuration.width, 100))))),
        Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.round(Math.abs(toNumber(configuration.height, 100))))),
        Math.min(128, Math.max(2, Math.round(Math.abs(toNumber(configuration.n, 6))))),
        outerRadius,
        innerRadius,
        ratio,
        shape === 'arc' || shape === 'circular segment' ? toNumber(angle.start, 0) : 0,
        shape === 'arc' || shape === 'circular segment' ? toNumber(angle.end, 360) : 360,
        color,
        opacity
    ]);
};

const createLineBitmap = configuration => {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const point1 = configuration.position1 || {};
    const point2 = configuration.position2 || {};
    const thickness = Math.max(0.001, Math.abs(toNumber(configuration.thickness, 5)));
    const padding = thickness / 2;
    const width = Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.ceil(
        Math.abs(toNumber(point2.x) - toNumber(point1.x)) + (padding * 2)
    )));
    const height = Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.ceil(
        Math.abs(toNumber(point2.y) - toNumber(point1.y)) + (padding * 2)
    )));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext && canvas.getContext('2d');
    if (!context) return null;
    canvas.width = width;
    canvas.height = height;
    const minX = Math.min(toNumber(point1.x), toNumber(point2.x));
    const maxY = Math.max(toNumber(point1.y), toNumber(point2.y));
    context.clearRect(0, 0, width, height);
    context.beginPath();
    // Scratch's world coordinates grow upward while a canvas bitmap's pixel coordinates grow downward.
    // Flip only the local bitmap Y coordinate so the scene transform can keep using Scratch coordinates.
    context.moveTo(toNumber(point1.x) - minX + padding, maxY - toNumber(point1.y) + padding);
    context.lineTo(toNumber(point2.x) - minX + padding, maxY - toNumber(point2.y) + padding);
    context.lineWidth = thickness;
    context.strokeStyle = typeof configuration.color === 'string' && configuration.color ?
        configuration.color : '#ffffff';
    context.globalAlpha = clamp(toNumber(configuration.opacity, 100), 0, 100) / 100;
    context.stroke();
    canvas.reusable = false;
    return canvas;
};

const createShapeBitmap = configuration => {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const requestedWidth = Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.round(
        Math.abs(toNumber(configuration.width, 100))
    )));
    const requestedHeight = Math.max(2, Math.min(MAX_SHAPE_SIZE, Math.round(
        Math.abs(toNumber(configuration.height, 100))
    )));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext && canvas.getContext('2d');
    if (!context) return null;

    const shape = normalizeShapeType(configuration.shape);
    if (shape === 'line') return null;
    const radius = configuration.radius || {};
    const outerRadius = Math.min(
        MAX_SHAPE_SIZE,
        Math.max(0.001, Math.abs(toNumber(
            shape === 'circular segment' ? configuration.size : radius.outer, 100
        )))
    );
    const innerRadius = Math.min(
        outerRadius,
        Math.max(0, Math.abs(toNumber(
            shape === 'circular segment' ? 0 : radius.inner,
            shape === 'circular segment' ? 0 : outerRadius * 0.5
        )))
    );
    const ratio = shape === 'star' || shape === 'curved star' || shape === 'flower' ?
        normalizeShapeRatio(configuration.ratio) : null;
    // Keep radius in the same coordinate system as the block's default 100px outer radius. The bitmap grows
    // when a larger radius is requested instead of normalizing every shape back to the requested dimensions.
    const scale = SHAPE_RADIUS_SCALE;
    const diameter = Math.max(2, Math.ceil(outerRadius * scale * 2));
    const logicalBitmapWidth = Math.max(requestedWidth, diameter);
    const logicalBitmapHeight = Math.max(requestedHeight, diameter);
    // Very large canvases are disproportionately expensive to clear, rasterize and upload to WebGL. Render the
    // same geometry into a bounded texture and lower its bitmap resolution so Scratch Render keeps the original
    // logical size. Using one uniform factor preserves circles and the shape's aspect ratio; limiting area instead
    // of each axis also keeps thin shapes sharp without allocating unnecessary pixels.
    const bitmapScale = Math.min(
        1,
        Math.sqrt(MAX_SHAPE_BITMAP_PIXELS / (
            logicalBitmapWidth * logicalBitmapHeight * BITMAP_RESOLUTION * BITMAP_RESOLUTION
        ))
    );
    const bitmapResolution = BITMAP_RESOLUTION * bitmapScale;
    const width = Math.max(2, Math.round(logicalBitmapWidth * bitmapResolution));
    const height = Math.max(2, Math.round(logicalBitmapHeight * bitmapResolution));
    canvas.width = width;
    canvas.height = height;
    canvas.movieBitmapResolution = bitmapResolution;
    const centerX = width / 2;
    const centerY = height / 2;
    const sides = Math.min(128, Math.max(2, Math.round(Math.abs(toNumber(configuration.n, 6)))));
    const pointCount = shape === 'polygon' ? sides : shape === 'flower' ? Math.max(24, sides * 12) : sides * 2;

    const radiusAt = (radiusValue, angle) => {
        if (shape === 'polygon') return radiusValue;
        if (shape === 'star' || shape === 'curved star') {
            return angle % 2 === 0 ? radiusValue : radiusValue * ratio;
        }
        const petal = (Math.cos((angle / pointCount) * sides * Math.PI * 2) + 1) / 2;
        return radiusValue * (ratio + ((1 - ratio) * Math.pow(petal, 0.45)));
    };

    const drawPath = (count, distanceAt, reverse = false) => {
        for (let index = 0; index < count; index++) {
            const pathIndex = reverse ? count - index - 1 : index;
            const angle = (-Math.PI / 2) + ((pathIndex / count) * Math.PI * 2);
            const distance = distanceAt(pathIndex) * scale * bitmapResolution;
            const x = centerX + (Math.cos(angle) * distance);
            const y = centerY + (Math.sin(angle) * distance);
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        }
        context.closePath();
    };

    const drawCurvedStarPath = (radiusValue, reverse = false) => {
        const pointAt = pointIndex => {
            const normalizedIndex = (pointIndex + pointCount) % pointCount;
            const angle = (-Math.PI / 2) + ((normalizedIndex / pointCount) * Math.PI * 2);
            const distance = radiusAt(radiusValue, normalizedIndex) * scale * bitmapResolution;
            return {
                x: centerX + (Math.cos(angle) * distance),
                y: centerY + (Math.sin(angle) * distance)
            };
        };
        const start = pointAt(0);
        context.moveTo(start.x, start.y);
        for (let index = 0; index < sides; index++) {
            const outerIndex = reverse ? ((sides - index) % sides) * 2 : index * 2;
            const nextOuterIndex = reverse ?
                (outerIndex - 2 + pointCount) % pointCount : (outerIndex + 2) % pointCount;
            const controlIndex = reverse ?
                (nextOuterIndex + 1) % pointCount : outerIndex + 1;
            const control = pointAt(controlIndex);
            const next = pointAt(nextOuterIndex);
            context.quadraticCurveTo(control.x, control.y, next.x, next.y);
        }
        context.closePath();
    };

    context.clearRect(0, 0, width, height);
    context.beginPath();
    if (shape === 'arc' || shape === 'circular segment') {
        const angle = configuration.angle || {};
        const start = (toNumber(angle.start, 0) - 90) * Math.PI / 180;
        const end = (toNumber(angle.end, 360) - 90) * Math.PI / 180;
        // Keep the endpoints unwrapped so their order describes the sweep direction.
        const anticlockwise = end < start;
        const outerStartX = centerX + (Math.cos(start) * outerRadius * scale * bitmapResolution);
        const outerStartY = centerY + (Math.sin(start) * outerRadius * scale * bitmapResolution);
        context.moveTo(outerStartX, outerStartY);
        context.arc(centerX, centerY, outerRadius * scale * bitmapResolution, start, end, anticlockwise);
        if (shape === 'arc' && innerRadius > 0) {
            context.arc(centerX, centerY, innerRadius * scale * bitmapResolution, end, start, !anticlockwise);
        } else {
            context.lineTo(outerStartX, outerStartY);
        }
    } else if (shape === 'curved star') {
        drawCurvedStarPath(outerRadius);
        if (innerRadius > 0) drawCurvedStarPath(innerRadius, true);
    } else {
        drawPath(pointCount, angle => radiusAt(outerRadius, angle));
        if (innerRadius > 0) drawPath(pointCount, angle => radiusAt(innerRadius, angle), true);
    }
    context.fillStyle = typeof configuration.color === 'string' && configuration.color ?
        configuration.color : '#ffffff';
    context.globalAlpha = clamp(toNumber(configuration.opacity, 100), 0, 100) / 100;
    context.fill('evenodd');
    canvas.reusable = false;
    return canvas;
};

const cloneScale = scale => ({
    x: normalizeScale(scale && scale.x),
    y: normalizeScale(scale && scale.y),
    z: normalizeScale(scale && scale.z)
});

const cloneCamera = camera => {
    if (!camera) return null;
    const clone = {...camera};
    if (camera.position) clone.position = {...camera.position};
    if (camera.rotation) clone.rotation = {...camera.rotation};
    return clone;
};

export {
    BITMAP_RESOLUTION,
    MAX_CACHED_SHAPE_SKINS,
    MAX_CACHED_SHAPE_SKIN_PIXELS,
    MODEL_SUPPORT_EXTENSIONS,
    MODEL_TEXTURE_FORMATS,
    canvasToBlob,
    clamp,
    cloneCamera,
    cloneScale,
    copyArrayBuffer,
    createLineBitmap,
    createShapeBitmap,
    escapeRegExp,
    getCostumeAssetId,
    getExtension,
    getImportMimeType,
    getModelResourcePath,
    getName,
    getOriginalTarget,
    getShapeBitmapCacheKey,
    getUploadPath,
    getVideoMetadata,
    isWithinTimeWindow,
    normalizeCostumeGroup,
    normalizeImportError,
    normalizeRotationOrder,
    normalizeScale,
    normalizeShapeRatio,
    normalizeShapeType,
    normalizeTimelineKeyframes,
    now,
    once,
    readFile,
    toNumber,
    unusedName,
    wait
};
