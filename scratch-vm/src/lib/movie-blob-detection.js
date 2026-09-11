const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const normalizeFrame = frame => {
    if (!frame || !frame.data) return null;
    const width = Math.max(1, Math.round(Number(frame.width) || 0));
    const height = Math.max(1, Math.round(Number(frame.height) || 0));
    if (frame.data.length < width * height * 4) return null;
    return {data: frame.data, height, width};
};

const straightChannel = (data, offset, channel) => {
    const alpha = data[offset + 3];
    if (alpha <= 0) return 0;
    return clamp((data[offset + channel] * 255) / alpha, 0, 255);
};

const luminance = (data, offset) => (
    (straightChannel(data, offset, 0) * 0.299) +
    (straightChannel(data, offset, 1) * 0.587) +
    (straightChannel(data, offset, 2) * 0.114)
);

// Specialized integral builders keep the hot per-pixel loops free of closure
// dispatch while producing bit-identical sums to a generic sample() walk.
const buildAlphaIntegral = frame => {
    const data = frame.data;
    const width = frame.width;
    const stride = width + 1;
    const values = new Float64Array(stride * (frame.height + 1));
    for (let y = 0; y < frame.height; y++) {
        let row = 0;
        let offset = y * width * 4;
        const previousRow = y * stride;
        const currentRow = previousRow + stride;
        for (let x = 0; x < width; x++, offset += 4) {
            row += data[offset + 3];
            values[currentRow + x + 1] = values[previousRow + x + 1] + row;
        }
    }
    return values;
};

const buildLumaIntegral = frame => {
    const data = frame.data;
    const width = frame.width;
    const stride = width + 1;
    const values = new Float64Array(stride * (frame.height + 1));
    for (let y = 0; y < frame.height; y++) {
        let row = 0;
        let offset = y * width * 4;
        const previousRow = y * stride;
        const currentRow = previousRow + stride;
        for (let x = 0; x < width; x++, offset += 4) {
            const alpha = data[offset + 3];
            if (alpha > 0) {
                const r = clamp((data[offset] * 255) / alpha, 0, 255);
                const g = clamp((data[offset + 1] * 255) / alpha, 0, 255);
                const b = clamp((data[offset + 2] * 255) / alpha, 0, 255);
                row += (r * 0.299) + (g * 0.587) + (b * 0.114);
            }
            values[currentRow + x + 1] = values[previousRow + x + 1] + row;
        }
    }
    return values;
};

const buildChannelIntegral = (frame, channel) => {
    const data = frame.data;
    const width = frame.width;
    const stride = width + 1;
    const values = new Float64Array(stride * (frame.height + 1));
    for (let y = 0; y < frame.height; y++) {
        let row = 0;
        let offset = y * width * 4;
        const previousRow = y * stride;
        const currentRow = previousRow + stride;
        for (let x = 0; x < width; x++, offset += 4) {
            const alpha = data[offset + 3];
            if (alpha > 0) {
                row += clamp((data[offset + channel] * 255) / alpha, 0, 255);
            }
            values[currentRow + x + 1] = values[previousRow + x + 1] + row;
        }
    }
    return values;
};

const makeMask = (frame, options, previousFrame) => {
    const requestedMode = String(options.mode).toLowerCase();
    const mode = ['alpha', 'bright', 'color', 'dark', 'motion'].includes(requestedMode) ?
        requestedMode : 'dark';
    const threshold = clamp(Number(options.threshold) || 0, 0, 255);
    const blurRadius = clamp(Math.round(Number(options.blurRadius) || 0), 0, 100);
    const targetColor = Array.isArray(options.targetColor) || ArrayBuffer.isView(options.targetColor) ?
        options.targetColor : [1, 1, 1];
    const mask = new Uint8Array(frame.width * frame.height);
    const previousMatches = previousFrame && previousFrame.width === frame.width &&
        previousFrame.height === frame.height;
    if (mode === 'motion' && !previousMatches) return mask;

    const data = frame.data;
    const width = frame.width;
    const height = frame.height;
    const lumaIntegral = blurRadius > 0 && mode !== 'color' ? buildLumaIntegral(frame) : null;
    const alphaIntegral = blurRadius > 0 ? buildAlphaIntegral(frame) : null;
    const colorIntegrals = blurRadius > 0 && mode === 'color' ? [
        buildChannelIntegral(frame, 0),
        buildChannelIntegral(frame, 1),
        buildChannelIntegral(frame, 2)
    ] : null;
    const previousLumaIntegral = blurRadius > 0 && mode === 'motion' ?
        buildLumaIntegral(previousFrame) : null;
    const targetChannels = mode === 'color' ? [
        clamp(Number(targetColor[0]) || 0, 0, 1) * 255,
        clamp(Number(targetColor[1]) || 0, 0, 1) * 255,
        clamp(Number(targetColor[2]) || 0, 0, 1) * 255
    ] : null;
    const stride = width + 1;

    for (let y = 0; y < height; y++) {
        // Row geometry is shared by every integral, so hoist it out of the pixel loop.
        const y0 = y < blurRadius ? 0 : y - blurRadius;
        const y1 = y + blurRadius + 1 > height ? height : y + blurRadius + 1;
        const spanY = y1 - y0;
        const rowA = y0 * stride;
        const rowB = y1 * stride;
        for (let x = 0; x < width; x++) {
            const index = (y * width) + x;
            const offset = index * 4;
            let averageAlpha = 0;
            if (blurRadius > 0) {
                const x0 = x < blurRadius ? 0 : x - blurRadius;
                const x1 = x + blurRadius + 1 > width ? width : x + blurRadius + 1;
                averageAlpha = (alphaIntegral[rowB + x1] - alphaIntegral[rowA + x1] -
                    alphaIntegral[rowB + x0] + alphaIntegral[rowA + x0]) /
                    ((x1 - x0) * spanY);
            } else {
                averageAlpha = data[offset + 3];
            }
            let matches = false;
            if (mode === 'alpha') {
                matches = averageAlpha >= threshold;
            } else if (mode === 'color') {
                if (averageAlpha > 0) {
                    let distance = 0;
                    for (let channel = 0; channel < 3; channel++) {
                        let value;
                        if (colorIntegrals) {
                            const integral = colorIntegrals[channel];
                            const x0 = x < blurRadius ? 0 : x - blurRadius;
                            const x1 = x + blurRadius + 1 > width ? width : x + blurRadius + 1;
                            value = (integral[rowB + x1] - integral[rowA + x1] -
                                integral[rowB + x0] + integral[rowA + x0]) /
                                ((x1 - x0) * spanY);
                        } else {
                            value = straightChannel(data, offset, channel);
                        }
                        distance += Math.abs(value - targetChannels[channel]);
                    }
                    matches = distance < threshold * 3;
                }
            } else if (mode === 'motion') {
                let current;
                let previous;
                if (lumaIntegral) {
                    const x0 = x < blurRadius ? 0 : x - blurRadius;
                    const x1 = x + blurRadius + 1 > width ? width : x + blurRadius + 1;
                    current = (lumaIntegral[rowB + x1] - lumaIntegral[rowA + x1] -
                        lumaIntegral[rowB + x0] + lumaIntegral[rowA + x0]) /
                        ((x1 - x0) * spanY);
                    previous = (previousLumaIntegral[rowB + x1] - previousLumaIntegral[rowA + x1] -
                        previousLumaIntegral[rowB + x0] + previousLumaIntegral[rowA + x0]) /
                        ((x1 - x0) * spanY);
                } else {
                    current = luminance(data, offset);
                    previous = luminance(previousFrame.data, offset);
                }
                const alphaDelta = Math.abs(data[offset + 3] - previousFrame.data[offset + 3]);
                matches = Math.max(Math.abs(current - previous), alphaDelta) >= threshold;
            } else if (averageAlpha > 0) {
                let value;
                if (lumaIntegral) {
                    const x0 = x < blurRadius ? 0 : x - blurRadius;
                    const x1 = x + blurRadius + 1 > width ? width : x + blurRadius + 1;
                    value = (lumaIntegral[rowB + x1] - lumaIntegral[rowA + x1] -
                        lumaIntegral[rowB + x0] + lumaIntegral[rowA + x0]) /
                        ((x1 - x0) * spanY);
                } else {
                    value = luminance(data, offset);
                }
                matches = mode === 'bright' ? value >= threshold : value <= threshold;
            }
            mask[index] = matches ? 1 : 0;
        }
    }
    return mask;
};

const dilateMask = (mask, width, height, radius) => {
    if (radius <= 0) return mask;
    const stride = width + 1;
    const integral = new Uint32Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
        let row = 0;
        for (let x = 0; x < width; x++) {
            row += mask[(y * width) + x];
            integral[((y + 1) * stride) + x + 1] = integral[(y * stride) + x + 1] + row;
        }
    }
    const result = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
        const y0 = Math.max(0, y - radius);
        const y1 = Math.min(height, y + radius + 1);
        for (let x = 0; x < width; x++) {
            const x0 = Math.max(0, x - radius);
            const x1 = Math.min(width, x + radius + 1);
            const sum = integral[(y1 * stride) + x1] - integral[(y0 * stride) + x1] -
                integral[(y1 * stride) + x0] + integral[(y0 * stride) + x0];
            result[(y * width) + x] = sum > 0 ? 1 : 0;
        }
    }
    return result;
};

const findBoxes = (mask, frame) => {
    const boxes = [];
    const width = frame.width;
    const height = frame.height;
    const stack = new Int32Array(mask.length);
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start]) continue;
        mask[start] = 0;
        let head = 0;
        let tail = 1;
        stack[0] = start;
        let minimumX = start % width;
        let maximumX = minimumX;
        let minimumY = Math.floor(start / width);
        let maximumY = minimumY;
        let pixelArea = 0;
        while (head < tail) {
            const index = stack[head++];
            const x = index % width;
            const y = (index - x) / width;
            pixelArea++;
            if (x < minimumX) minimumX = x;
            else if (x > maximumX) maximumX = x;
            if (y < minimumY) minimumY = y;
            else if (y > maximumY) maximumY = y;
            // Visit left, right, up, down without allocating a neighbour array per pixel.
            if (x > 0 && mask[index - 1]) {
                mask[index - 1] = 0;
                stack[tail++] = index - 1;
            }
            if (x + 1 < width && mask[index + 1]) {
                mask[index + 1] = 0;
                stack[tail++] = index + 1;
            }
            if (y > 0 && mask[index - width]) {
                mask[index - width] = 0;
                stack[tail++] = index - width;
            }
            if (y + 1 < height && mask[index + width]) {
                mask[index + width] = 0;
                stack[tail++] = index + width;
            }
        }
        const centerX = Math.floor((minimumX + maximumX + 1) / 2);
        const centerY = Math.floor((minimumY + maximumY + 1) / 2);
        const centerOffset = ((centerY * width) + centerX) * 4;
        boxes.push({
            centerX,
            centerY,
            color: [0, 1, 2].map(channel => straightChannel(frame.data, centerOffset, channel)),
            height: maximumY - minimumY + 1,
            maximumX,
            maximumY,
            minimumX,
            minimumY,
            pixelArea,
            width: maximumX - minimumX + 1
        });
    }
    return boxes;
};

/**
 * Key a frame and return one bounding box for every four-connected region.
 * This follows HL_Blobox's core pipeline: keying, optional motion dilation,
 * connected-component extraction, then long-edge percentage filtering.
 * @param {object} inputFrame current premultiplied RGBA frame
 * @param {object} options keying and size options
 * @param {object} previousInputFrame previous frame used by motion mode
 * @returns {Array<object>} detected pixel-coordinate boxes
 */
const detectMovieBlobs = (inputFrame, options = {}, previousInputFrame = null) => {
    const frame = normalizeFrame(inputFrame);
    if (!frame) return [];
    const previousFrame = normalizeFrame(previousInputFrame);
    let mask = makeMask(frame, options, previousFrame);
    if (String(options.mode).toLowerCase() === 'motion') {
        mask = dilateMask(mask, frame.width, frame.height, 2);
    }
    const frameDimension = Math.max(frame.width, frame.height, 1);
    const minimumSize = clamp(Number(options.minimumSize) || 0, 0, 100);
    const maximumSizeValue = Number(options.maximumSize);
    const maximumSize = clamp(Number.isFinite(maximumSizeValue) ? maximumSizeValue : 100, minimumSize, 100);
    const maximumBoxes = clamp(Math.round(Number(options.maximumBoxes) || 100), 1, 1000);
    return findBoxes(mask, frame)
        .filter(box => {
            const percentage = Math.max(box.width, box.height) / frameDimension * 100;
            return percentage >= minimumSize && percentage <= maximumSize;
        })
        .sort((left, right) => (right.pixelArea - left.pixelArea) ||
            (left.minimumY - right.minimumY) || (left.minimumX - right.minimumX))
        .slice(0, maximumBoxes)
        .map((box, index) => ({...box, id: index + 1}));
};

const paintPixel = (output, index, rgb, opacity) => {
    const alpha = clamp(opacity, 0, 1);
    const inverse = 1 - alpha;
    const offset = index * 4;
    output[offset] = Math.round((clamp(rgb[0], 0, 1) * 255 * alpha) + (output[offset] * inverse));
    output[offset + 1] = Math.round((clamp(rgb[1], 0, 1) * 255 * alpha) + (output[offset + 1] * inverse));
    output[offset + 2] = Math.round((clamp(rgb[2], 0, 1) * 255 * alpha) + (output[offset + 2] * inverse));
    output[offset + 3] = Math.round((255 * alpha) + (output[offset + 3] * inverse));
};

/**
 * Draw debugger-style bounding boxes over a premultiplied RGBA frame.
 * @param {object} inputFrame source frame
 * @param {Array<object>} boxes detected boxes
 * @param {object} options overlay appearance
 * @param {Uint8Array} [outputBuffer] reusable output buffer of the same length as the frame
 * @returns {Uint8Array} frame containing the overlay
 */
const drawMovieBlobOverlay = (inputFrame, boxes, options = {}, outputBuffer = null) => {
    const frame = normalizeFrame(inputFrame);
    if (!frame) return new Uint8Array(0);
    const output = outputBuffer && outputBuffer.length === frame.data.length ?
        outputBuffer : new Uint8Array(frame.data.length);
    output.set(frame.data);
    if (!Array.isArray(boxes) || !boxes.length) return output;
    const overlay = new Uint8Array(frame.width * frame.height);
    const shape = String(options.shape).toLowerCase() === 'ellipse' ? 'ellipse' : 'rectangle';
    const strokeWidth = clamp(Math.round(Number(options.strokeWidth) || 1), 1, Math.max(frame.width, frame.height));
    const marker = options.marker === true;
    const fillOpacity = clamp(Number(options.fillOpacity) || 0, 0, 1);
    const strokeOpacityValue = Number(options.strokeOpacity);
    const strokeOpacity = clamp(Number.isFinite(strokeOpacityValue) ? strokeOpacityValue : 1, 0, 1);
    const overlayColor = Array.isArray(options.color) || ArrayBuffer.isView(options.color) ?
        options.color : [0, 1, 1];

    for (const box of boxes) {
        const x0 = clamp(Math.round(box.minimumX), 0, frame.width - 1);
        const x1 = clamp(Math.round(box.maximumX), 0, frame.width - 1);
        const y0 = clamp(Math.round(box.minimumY), 0, frame.height - 1);
        const y1 = clamp(Math.round(box.maximumY), 0, frame.height - 1);
        const centerX = (x0 + x1 + 1) / 2;
        const centerY = (y0 + y1 + 1) / 2;
        const radiusX = Math.max(0.5, (x1 - x0 + 1) / 2);
        const radiusY = Math.max(0.5, (y1 - y0 + 1) / 2);
        const innerRadiusX = Math.max(0, radiusX - strokeWidth);
        const innerRadiusY = Math.max(0, radiusY - strokeWidth);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                let inside = true;
                let onStroke;
                if (shape === 'ellipse') {
                    const dx = (x + 0.5 - centerX) / radiusX;
                    const dy = (y + 0.5 - centerY) / radiusY;
                    inside = (dx * dx) + (dy * dy) <= 1;
                    const insideInner = innerRadiusX > 0 && innerRadiusY > 0 &&
                        (((x + 0.5 - centerX) / innerRadiusX) ** 2) +
                        (((y + 0.5 - centerY) / innerRadiusY) ** 2) <= 1;
                    onStroke = inside && !insideInner;
                } else {
                    onStroke = x - x0 < strokeWidth || x1 - x < strokeWidth ||
                        y - y0 < strokeWidth || y1 - y < strokeWidth;
                }
                const index = (y * frame.width) + x;
                if (onStroke) overlay[index] = Math.max(overlay[index], Math.round(strokeOpacity * 255));
                else if (inside && fillOpacity > 0) {
                    overlay[index] = Math.max(overlay[index], Math.round(fillOpacity * 255));
                }
            }
        }
        if (marker) {
            const cx = clamp(Math.floor(centerX), 0, frame.width - 1);
            const cy = clamp(Math.floor(centerY), 0, frame.height - 1);
            const markerRadius = Math.max(3, strokeWidth * 2);
            for (let delta = -markerRadius; delta <= markerRadius; delta++) {
                const horizontalX = cx + delta;
                const verticalY = cy + delta;
                if (horizontalX >= 0 && horizontalX < frame.width) {
                    overlay[(cy * frame.width) + horizontalX] = Math.round(strokeOpacity * 255);
                }
                if (verticalY >= 0 && verticalY < frame.height) {
                    overlay[(verticalY * frame.width) + cx] = Math.round(strokeOpacity * 255);
                }
            }
        }
    }
    for (let index = 0; index < overlay.length; index++) {
        if (overlay[index]) paintPixel(output, index, overlayColor, overlay[index] / 255);
    }
    return output;
};

export {detectMovieBlobs as default, drawMovieBlobOverlay};
