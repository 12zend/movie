import * as THREE from 'three';

const toByte = value => {
    const finiteValue = Number.isFinite(value) ? value : 0;
    return Math.round(Math.min(1, Math.max(0, finiteValue)) * 255);
};

const exrPixelsToRgba = ({data, width, height}) => {
    const pixelCount = width * height;
    const channels = data.length / pixelCount;
    if (!pixelCount || !Number.isInteger(channels) || channels < 1) {
        throw new Error('The EXR file has invalid image data.');
    }
    const rgba = new Uint8ClampedArray(pixelCount * 4);
    for (let pixel = 0; pixel < pixelCount; pixel++) {
        const sourceOffset = pixel * channels;
        const outputOffset = pixel * 4;
        const red = data[sourceOffset];
        rgba[outputOffset] = toByte(red);
        rgba[outputOffset + 1] = toByte(channels > 1 ? data[sourceOffset + 1] : red);
        rgba[outputOffset + 2] = toByte(channels > 2 ? data[sourceOffset + 2] : red);
        rgba[outputOffset + 3] = toByte(channels > 3 ? data[sourceOffset + 3] : 1);
    }
    return rgba;
};

const exrConverter = async fileData => {
    const {EXRLoader} = await import('three/examples/jsm/loaders/EXRLoader.js');
    const decoded = new EXRLoader()
        .setDataType(THREE.FloatType)
        .parse(fileData);
    const canvas = document.createElement('canvas');
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a canvas for the EXR costume.');
    const imageData = context.createImageData(decoded.width, decoded.height);
    imageData.data.set(exrPixelsToRgba(decoded));
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
};

export {
    exrPixelsToRgba
};

export default exrConverter;
