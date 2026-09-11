import {calculateEasingProgress, normalizeEasingType} from './movie-easing';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const finiteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;

// Parsed curves are pure functions of their source string, and the same strings are re-evaluated
// every frame for every placed block. Memoize the parse so repeated evaluation skips the regex
// work. The cache is bounded: curve text that changes every frame must not grow it without end.
// Cached point arrays are shared between evaluations, so callers must treat them as read-only.
const PARSE_CACHE_LIMIT = 512;

const memoizedStringParser = parse => {
    const cache = new Map();
    return value => {
        if (typeof value !== 'string') return parse(value);
        let points = cache.get(value);
        if (!points) {
            points = parse(value);
            if (cache.size >= PARSE_CACHE_LIMIT) cache.delete(cache.keys().next().value);
            cache.set(value, points);
        }
        return points;
    };
};

const parseBezierPathPoints = memoizedStringParser(value => {
    let values = value;
    if (!Array.isArray(values)) {
        const source = String(value || '').trim();
        if (!source) return [];
        if (source[0] === '[') {
            try {
                values = JSON.parse(source);
            } catch (error) {
                // Scratch list reporters expose their items as an editor-friendly, space-separated string.
            }
        }
        if (!Array.isArray(values)) values = source.split(/[\s,]+/);
    }

    const flattened = [];
    values.forEach(item => {
        if (Array.isArray(item)) flattened.push(...item);
        else if (item && typeof item === 'object') flattened.push(item.x, item.y);
        else flattened.push(item);
    });
    const points = [];
    for (let index = 0; index + 1 < flattened.length; index += 2) {
        points.push({
            x: finiteNumber(flattened[index]),
            y: finiteNumber(flattened[index + 1])
        });
    }
    return points;
});

const evaluateBezierPath = (path, component, time) => {
    const points = parseBezierPathPoints(path);
    if (!points.length) return 0;
    const axis = String(component || '').toLowerCase() === 'y' ? 'y' : 'x';
    const segmentCount = points.length - 1;
    if (!segmentCount) return points[0][axis];

    const pathTime = clamp(finiteNumber(time), 0, segmentCount);
    const segmentIndex = pathTime >= segmentCount ? segmentCount - 1 : Math.floor(pathTime);
    const progress = pathTime >= segmentCount ? 1 : pathTime - segmentIndex;
    const inverse = 1 - progress;
    const start = points[segmentIndex][axis];
    const end = points[segmentIndex + 1][axis];
    const previous = points[Math.max(0, segmentIndex - 1)][axis];
    const next = points[Math.min(points.length - 1, segmentIndex + 2)][axis];
    // Convert a uniform Catmull-Rom segment into cubic Bezier control points. This lets creators list
    // only the positions the path must pass through while retaining a smooth tangent at every join.
    const control1 = start + ((end - previous) / 6);
    const control2 = end - ((next - start) / 6);
    return (inverse * inverse * inverse * start) +
        (3 * inverse * inverse * progress * control1) +
        (3 * inverse * progress * progress * control2) +
        (progress * progress * progress * end);
};

const TIME_SCOPE_TYPES = ['range', 'offset', 'scale', 'loop', 'pingpong', 'freeze', 'reverse', 'remap'];

const parseCurvePoints = memoizedStringParser(value => {
    if (Array.isArray(value)) {
        return value.map(point => {
            if (Array.isArray(point)) return {time: finiteNumber(point[0]), value: point[1], easing: point[2]};
            if (!point || typeof point !== 'object') return null;
            return {
                time: finiteNumber(Object.prototype.hasOwnProperty.call(point, 'time') ? point.time : point.t),
                value: Object.prototype.hasOwnProperty.call(point, 'value') ? point.value : point.v,
                easing: point.easing
            };
        })
            .filter(Boolean)
            .sort((a, b) => a.time - b.time);
    }

    const source = String(value || '').trim();
    if (!source) return [];
    if (source[0] === '[' || source[0] === '{') {
        try {
            const parsed = JSON.parse(source);
            return parseCurvePoints(Array.isArray(parsed) ? parsed : parsed.points);
        } catch (error) {
            // Fall through to the compact, editor-friendly notation.
        }
    }
    return source.split(/[;\n]+/).map(entry => {
        const match = /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*(?::|=|->|→)\s*(.*?)\s*$/.exec(entry);
        if (!match) return null;
        const valueAndEasing = match[2].split(/\s*@\s*/);
        const rawValue = valueAndEasing[0].trim();
        const numericValue = Number(rawValue);
        return {
            time: Number(match[1]),
            value: Number.isFinite(numericValue) ? numericValue : rawValue,
            easing: valueAndEasing[1]
        };
    })
        .filter(Boolean)
        .sort((a, b) => a.time - b.time);
});

const getCurveSegment = (points, time) => {
    if (!points.length) return null;
    const currentTime = finiteNumber(time);
    if (currentTime <= points[0].time) return {from: points[0], progress: 0, to: points[0]};
    const last = points[points.length - 1];
    if (currentTime >= last.time) return {from: last, progress: 1, to: last};
    for (let index = 1; index < points.length; index++) {
        const to = points[index];
        if (currentTime <= to.time) {
            const from = points[index - 1];
            const duration = to.time - from.time;
            const linearProgress = duration > 0 ? (currentTime - from.time) / duration : 1;
            return {
                from,
                progress: calculateEasingProgress(normalizeEasingType(to.easing || 'Linear'), linearProgress),
                to
            };
        }
    }
    return {from: last, progress: 1, to: last};
};

const evaluateNumberCurve = (curve, time) => {
    const segment = getCurveSegment(parseCurvePoints(curve), time);
    if (!segment) return 0;
    const from = finiteNumber(segment.from.value);
    const to = finiteNumber(segment.to.value, from);
    return from + ((to - from) * segment.progress);
};

const evaluateStepCurve = (curve, time) => {
    const points = parseCurvePoints(curve);
    if (!points.length) return '';
    const currentTime = finiteNumber(time);
    let result = points[0].value;
    for (const point of points) {
        if (point.time > currentTime) break;
        result = point.value;
    }
    return result;
};

const transformTimeByScope = (time, requestedScope) => {
    const scope = requestedScope && typeof requestedScope === 'object' ? requestedScope : {};
    const type = TIME_SCOPE_TYPES.includes(scope.type) ? scope.type : '';
    const currentTime = finiteNumber(time);
    if (type === 'range') return currentTime - finiteNumber(scope.start);
    if (type === 'offset') return currentTime - finiteNumber(scope.offset);
    if (type === 'scale') return currentTime * finiteNumber(scope.scale, 1);
    if (type === 'loop') {
        const duration = Math.abs(finiteNumber(scope.duration));
        return duration > 0 ? positiveModulo(currentTime, duration) : 0;
    }
    if (type === 'pingpong') {
        const duration = Math.abs(finiteNumber(scope.duration));
        if (duration <= 0) return 0;
        const cycle = positiveModulo(currentTime, duration * 2);
        return cycle <= duration ? cycle : (duration * 2) - cycle;
    }
    if (type === 'freeze') return finiteNumber(scope.time);
    if (type === 'reverse') return finiteNumber(scope.duration) - currentTime;
    if (type === 'remap') return evaluateNumberCurve(scope.map, currentTime);
    return currentTime;
};

const evaluateTimeScopes = (time, scopes) => {
    if (!Array.isArray(scopes) || !scopes.length) return finiteNumber(time);
    return scopes.reduce((result, scope) => transformTimeByScope(result, scope), finiteNumber(time));
};

const getObjectTime = (runtime, util, configuration = null) => {
    const manager = runtime && runtime.movieAssetManager;
    const timelineTime = manager && manager.timeline && Number(manager.timeline.currentTime);
    const managerTime = configuration && manager && typeof manager.getObjectEvaluationTime === 'function' ?
        Number(manager.getObjectEvaluationTime(configuration)) : null;
    let time = Number.isFinite(managerTime) ? managerTime : Number.isFinite(timelineTime) ? timelineTime : 0;
    if (!Number.isFinite(timelineTime) && util && typeof util.ioQuery === 'function') {
        time = finiteNumber(util.ioQuery('clock', 'projectTimer'));
    }
    const thread = util && util.thread;
    const offset = thread ? finiteNumber(thread.objectTimeOffset) : 0;
    return evaluateTimeScopes(time - offset, thread && thread.objectTimeScopes);
};

const calculateAnimationValue = ({from, to, start, end, easing, power = 2}, time) => {
    const startValue = finiteNumber(from);
    const endValue = finiteNumber(to);
    const startTime = finiteNumber(start);
    const endTime = finiteNumber(end);
    const currentTime = finiteNumber(time);
    if (endTime <= startTime) return currentTime < startTime ? startValue : endValue;
    if (currentTime <= startTime) return startValue;
    if (currentTime >= endTime) return endValue;
    const progress = (currentTime - startTime) / (endTime - startTime);
    const eased = calculateEasingProgress(normalizeEasingType(easing), progress, power);
    return startValue + ((endValue - startValue) * eased);
};

const calculateLoopValue = (from, to, duration, time) => {
    const startValue = finiteNumber(from);
    const endValue = finiteNumber(to);
    const period = Math.abs(finiteNumber(duration));
    if (period <= 0) return startValue;
    const progress = positiveModulo(finiteNumber(time), period) / period;
    return startValue + ((endValue - startValue) * progress);
};

const calculatePingPongValue = (from, to, duration, time) => {
    const startValue = finiteNumber(from);
    const endValue = finiteNumber(to);
    const period = Math.abs(finiteNumber(duration));
    if (period <= 0) return startValue;
    const cycle = positiveModulo(finiteNumber(time), period) / period;
    const progress = cycle <= 0.5 ? cycle * 2 : (1 - cycle) * 2;
    return startValue + ((endValue - startValue) * progress);
};

// Deterministic integer hash returning a value in [-1, 1]. It deliberately avoids Math.random so
// seeking to a frame and rendering that frame offline always produce exactly the same result.
const seededNoise = (index, seed) => {
    let value = (Math.trunc(index) ^ Math.imul(Math.trunc(seed), 0x45d9f3b)) | 0;
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value ^= value >>> 16;
    return (((value >>> 0) / 0xffffffff) * 2) - 1;
};

const calculateWiggleValue = (frequency, amount, seed, time) => {
    const cyclesPerSecond = Math.abs(finiteNumber(frequency));
    const amplitude = finiteNumber(amount);
    if (cyclesPerSecond <= 0 || amplitude === 0) return 0;
    const sample = finiteNumber(time) * cyclesPerSecond;
    const index = Math.floor(sample);
    const progress = sample - index;
    const smoothProgress = progress * progress * (3 - (2 * progress));
    const first = seededNoise(index, seed);
    const second = seededNoise(index + 1, seed);
    return (first + ((second - first) * smoothProgress)) * amplitude;
};

const isTimeWithin = (time, start, end) => {
    const first = finiteNumber(start);
    const second = finiteNumber(end);
    const minimum = Math.min(first, second);
    const maximum = Math.max(first, second);
    const current = finiteNumber(time);
    return current >= minimum && current <= maximum;
};

const posterizeTime = (time, framerate) => {
    const fps = Math.abs(finiteNumber(framerate));
    if (fps <= 0) return 0;
    return Math.floor((finiteNumber(time) * fps) + 1e-9) / fps;
};

const parseHexColor = value => {
    const source = String(value || '').trim();
    const short = /^#([0-9a-f]{3})$/i.exec(source);
    if (short) return short[1].split('').map(component => parseInt(component + component, 16));
    const full = /^#([0-9a-f]{6})$/i.exec(source);
    if (full) {
        return [
            parseInt(full[1].slice(0, 2), 16),
            parseInt(full[1].slice(2, 4), 16),
            parseInt(full[1].slice(4, 6), 16)
        ];
    }
    return [0, 0, 0];
};

const toHexColor = components => `#${components.map(component => (
    Math.round(clamp(component, 0, 255))
        .toString(16)
        .padStart(2, '0')
)).join('')}`;

const interpolateColor = (from, to, progress) => {
    const start = parseHexColor(from);
    const end = parseHexColor(to);
    const amount = clamp(finiteNumber(progress), 0, 1);
    return toHexColor(start.map((component, index) => component + ((end[index] - component) * amount)));
};

const interpolateAngle = (from, to, progress) => {
    const start = finiteNumber(from);
    const end = finiteNumber(to);
    const delta = positiveModulo(end - start + 180, 360) - 180;
    return start + (delta * clamp(finiteNumber(progress), 0, 1));
};

const evaluateColorCurve = (curve, time) => {
    const segment = getCurveSegment(parseCurvePoints(curve), time);
    if (!segment) return '#000000';
    return interpolateColor(segment.from.value, segment.to.value, segment.progress);
};

const evaluateAngleCurve = (curve, time) => {
    const segment = getCurveSegment(parseCurvePoints(curve), time);
    if (!segment) return 0;
    return interpolateAngle(segment.from.value, segment.to.value, segment.progress);
};

const getAnimationProgress = ({start, end, easing, power = 2}, time) => calculateAnimationValue({
    from: 0,
    to: 1,
    start,
    end,
    easing,
    power
}, time);

export {
    calculateAnimationValue,
    calculateLoopValue,
    calculatePingPongValue,
    calculateWiggleValue,
    evaluateAngleCurve,
    evaluateBezierPath,
    evaluateColorCurve,
    evaluateNumberCurve,
    evaluateStepCurve,
    evaluateTimeScopes,
    finiteNumber,
    getAnimationProgress,
    getObjectTime,
    interpolateAngle,
    interpolateColor,
    isTimeWithin,
    posterizeTime
};
