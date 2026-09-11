import * as THREE from 'three';

// This module owns the Movie coordinate system and the small Three.js objects which are
// submitted to the model renderer. Model loading and frame submission live elsewhere so
// changes to projection math do not require navigating loader code.
const MODEL_RENDER_SIZE = 512;
const MODEL_DISPLAY_SIZE = 150;
const DEFAULT_FOCAL_LENGTH = 480;
const DEFAULT_STAGE_WIDTH = 480;
const DEFAULT_STAGE_HEIGHT = 360;
const DEFAULT_FOV = 2 * Math.atan((Math.max(DEFAULT_STAGE_WIDTH, DEFAULT_STAGE_HEIGHT) / 2) /
    DEFAULT_FOCAL_LENGTH) * (180 / Math.PI);
const DEFAULT_DEPTH = 480;
const ROTATION_ORDERS = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'];
// Keep the preview-oriented studio setup in one place. My Blocks Scene uses
// the same values when Movie has not received an authored lighting block.
const STUDIO_LIGHTING = Object.freeze({
    hemisphere: Object.freeze({
        direction: Object.freeze({x: 0, y: 1, z: 0}),
        groundColor: 0x303848,
        intensity: 1.8,
        skyColor: 0xffffff
    }),
    directional: Object.freeze([
        Object.freeze({color: 0xffffff, intensity: 2.2, position: Object.freeze({x: 2, y: 3, z: 4})}),
        Object.freeze({color: 0x8eb8ff, intensity: 0.9, position: Object.freeze({x: -4, y: 1, z: 2})})
    ])
});
const MMD_FRAME_RATE = 30;
const POINT_SHADOW_MAP_SIZE = 256;
const SPOT_SHADOW_MAP_SIZE = 512;
const DEFAULT_SHADOW_FAR = 10000;
const TRANSPARENT_TEXTURE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQDJ' +
    'Pv/AAAAAAElFTkSuQmCC';
const TEXTURE_MIME_TYPES = {
    bmp: 'image/bmp',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    spa: 'image/bmp',
    sph: 'image/bmp',
    tga: 'image/x-tga',
    webp: 'image/webp'
};

const DEFAULT_BUILDING_MATERIAL = Object.freeze({
    albedo: '#ff00ff',
    emission: '#000000',
    ior: 1.45,
    roughness: 1
});

const normalizeFOV = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_FOV;
    return Math.min(179.999, Math.max(0.001, number));
};

const focalLengthFromFOV = (fov, width = DEFAULT_STAGE_WIDTH, height = DEFAULT_STAGE_HEIGHT) => {
    const halfLongSide = Math.max(Number(width) || DEFAULT_STAGE_WIDTH, Number(height) || DEFAULT_STAGE_HEIGHT) / 2;
    return halfLongSide / Math.tan(normalizeFOV(fov) * Math.PI / 360);
};

const fovFromFocalLength = (focalLength, width = DEFAULT_STAGE_WIDTH, height = DEFAULT_STAGE_HEIGHT) => {
    const halfLongSide = Math.max(Number(width) || DEFAULT_STAGE_WIDTH, Number(height) || DEFAULT_STAGE_HEIGHT) / 2;
    const safeFocalLength = Math.max(0.001, Number(focalLength) || DEFAULT_FOCAL_LENGTH);
    return 2 * Math.atan(halfLongSide / safeFocalLength) * (180 / Math.PI);
};

// Shared temporaries for the per-frame math below. Every helper that uses one consumes it fully
// before returning, so no temporary escapes into stored state. This keeps steady-state rendering
// from allocating Quaternions, Eulers and Matrix4s for every drawable on every frame.
const scratchEuler = new THREE.Euler();
const scratchRotationFlipZ = new THREE.Matrix4().makeScale(1, 1, -1);
const scratchRotationMatrixA = new THREE.Matrix4();
const scratchRotationMatrixB = new THREE.Matrix4();
const scratchInverseCameraRotation = new THREE.Quaternion();
const scratchPlaneObjectRotation = new THREE.Quaternion();
const scratchPlaneInverseCameraRotation = new THREE.Quaternion();
const scratchPlaneOrigin = new THREE.Vector3();
const scratchPlaneOffset = new THREE.Vector3();
const scratchPlaneAxisX = new THREE.Vector3();
const scratchPlaneAxisY = new THREE.Vector3();
const scratchPlaneAxisZ = new THREE.Vector3();

const degreesToEuler = (rotation, order) => scratchEuler.set(
    THREE.MathUtils.degToRad(rotation.x),
    THREE.MathUtils.degToRad(rotation.y),
    THREE.MathUtils.degToRad(rotation.z),
    ROTATION_ORDERS.includes(order) ? order : 'XYZ'
);

const movieRotationToThreeQuaternion = (rotation, order) => {
    const movieRotation = scratchRotationMatrixA.makeRotationFromEuler(degreesToEuler(rotation, order));
    const threeRotation = scratchRotationMatrixB.copy(scratchRotationFlipZ)
        .multiply(movieRotation)
        .multiply(scratchRotationFlipZ);
    return new THREE.Quaternion().setFromRotationMatrix(threeRotation);
};

const moviePositionToThree = position => new THREE.Vector3(position.x, position.y, -position.z);

const clampLightValue = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

const normalizeLight = light => ({
    angle: clampLightValue(light && light.angle, 0.1, 90, 45),
    color: light && light.color,
    intensity: clampLightValue(light && light.intensity, 0, Number.MAX_SAFE_INTEGER, 1),
    position: {
        x: clampLightValue(light && light.position && light.position.x, -Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER, 0),
        y: clampLightValue(light && light.position && light.position.y, -Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER, 0),
        z: clampLightValue(light && light.position && light.position.z, -Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER, 0)
    },
    radius: clampLightValue(light && light.radius, 0, Number.MAX_SAFE_INTEGER, 0),
    shadow: clampLightValue(light && light.shadow, 0, 1, 0),
    type: light && light.type === 'spot' ? 'spot' : 'point'
});

const verticalFOVFromFocalLength = (focalLength, height) => (
    2 * Math.atan((Math.max(1, height) / 2) / Math.max(0.001, focalLength)) * (180 / Math.PI)
);

const modelScale = value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 1;
};

const buildingNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

const buildingUV = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

const buildingZ = value => {
    const z = buildingNumber(value);
    return z === 0 ? 0 : -z;
};

const setBuildingUVs = (geometry, requestedUV) => {
    const uv = geometry.getAttribute('uv');
    if (!uv) return;
    const u1 = buildingUV(requestedUV && requestedUV.u1);
    const v1 = buildingUV(requestedUV && requestedUV.v1);
    const u2 = buildingUV(requestedUV && requestedUV.u2);
    const v2 = buildingUV(requestedUV && requestedUV.v2);
    for (let index = 0; index < uv.count; index++) {
        uv.setXY(
            index,
            u1 + ((u2 - u1) * uv.getX(index)),
            v1 + ((v2 - v1) * uv.getY(index))
        );
    }
    uv.needsUpdate = true;
};

const makeBuildingPlaneGeometry = (positions, requestedUV) => {
    const u1 = buildingUV(requestedUV && requestedUV.u1);
    const v1 = buildingUV(requestedUV && requestedUV.v1);
    const u2 = buildingUV(requestedUV && requestedUV.u2);
    const v2 = buildingUV(requestedUV && requestedUV.v2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
        u1, v1,
        u2, v1,
        u2, v2,
        u1, v2
    ], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    return geometry;
};

const makeBuildingMaterial = () => {
    const material = new THREE.MeshStandardMaterial({
        color: DEFAULT_BUILDING_MATERIAL.albedo,
        emissive: DEFAULT_BUILDING_MATERIAL.emission,
        metalness: 0,
        roughness: DEFAULT_BUILDING_MATERIAL.roughness,
        side: THREE.DoubleSide
    });
    // Keep the runtime material shape stable. IOR has no visual effect without transmission,
    // while MeshStandardMaterial avoids the heavier physical-material shader.
    material.ior = DEFAULT_BUILDING_MATERIAL.ior;
    return material;
};

const createBuildingPrimitive = (type, requestedBounds, requestedUV, material = makeBuildingMaterial()) => {
    const bounds = requestedBounds || {};
    const x1 = buildingNumber(bounds.x1);
    const y1 = buildingNumber(bounds.y1);
    const z1 = buildingNumber(bounds.z1);
    const x2 = buildingNumber(bounds.x2);
    const y2 = buildingNumber(bounds.y2);
    const z2 = buildingNumber(bounds.z2);
    let geometry;

    if (type === 'wall') {
        geometry = makeBuildingPlaneGeometry([
            x1, y1, buildingZ(z1),
            x2, y1, buildingZ(z2),
            x2, y2, buildingZ(z2),
            x1, y2, buildingZ(z1)
        ], requestedUV);
    } else if (type === 'floor') {
        geometry = makeBuildingPlaneGeometry([
            x1, y1, buildingZ(z1),
            x2, y1, buildingZ(z1),
            x2, y2, buildingZ(z2),
            x1, y2, buildingZ(z2)
        ], requestedUV);
    } else {
        geometry = new THREE.BoxGeometry(
            Math.abs(x2 - x1),
            Math.abs(y2 - y1),
            Math.abs(z2 - z1)
        );
        geometry.translate((x1 + x2) / 2, (y1 + y2) / 2, buildingZ((z1 + z2) / 2));
        setBuildingUVs(geometry, requestedUV);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.movieStaticPlane = true;
    mesh.name = `Movie ${type}`;
    return mesh;
};

const createImagePlane = (sourceTexture, requestedWidth, requestedHeight, requestedRotationCenter) => {
    const width = Math.max(0.001, Number(requestedWidth) || 0.001);
    const height = Math.max(0.001, Number(requestedHeight) || 0.001);
    const texture = sourceTexture && sourceTexture.isTexture ?
        sourceTexture.clone() : new THREE.Texture(sourceTexture);
    texture.colorSpace = THREE.SRGBColorSpace;
    // These planes are refreshed frequently (especially video). Mipmap generation would rebuild the full
    // chain for every new frame, while stage-sized Movie output only needs linear sampling.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const geometry = new THREE.PlaneGeometry(width, height);
    const rotationCenter = requestedRotationCenter || {};
    const centerX = Number.isFinite(Number(rotationCenter.x)) ? Number(rotationCenter.x) : width / 2;
    const centerY = Number.isFinite(Number(rotationCenter.y)) ? Number(rotationCenter.y) : height / 2;
    geometry.translate((width / 2) - centerX, centerY - (height / 2), 0);

    const material = new THREE.MeshBasicMaterial({
        alphaTest: 1 / 255,
        depthTest: true,
        depthWrite: true,
        map: texture,
        side: THREE.DoubleSide,
        toneMapped: false,
        // Alpha-tested planes stay in the opaque pass: visibility is decided by the GPU depth buffer, not by
        // Three.js's transparent-object painter ordering. The render target still receives the texture alpha.
        transparent: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.movieStaticPlane = true;
    mesh.name = 'Movie image plane';
    return mesh;
};

const loadBuildingTexture = (source, isColorTexture = true) => new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(source, texture => {
        texture.colorSpace = isColorTexture ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
        resolve(texture);
    }, null, reject);
});

const worldToCamera = (position, camera) => {
    const result = new THREE.Vector3(
        position.x - camera.position.x,
        position.y - camera.position.y,
        position.z - camera.position.z
    );
    const inverseCamera = scratchInverseCameraRotation
        .setFromEuler(degreesToEuler(camera.rotation, camera.rotationOrder))
        .invert();
    return result.applyQuaternion(inverseCamera);
};

const projectPosition = (position, camera) => {
    const cameraSpace = worldToCamera(position, camera);
    const inFront = cameraSpace.z > 0.001;
    const safeDepth = inFront ? cameraSpace.z : 0.001;
    const perspective = camera.focalLength / safeDepth;
    return {
        depth: cameraSpace.z,
        inFront,
        perspective,
        x: cameraSpace.x * perspective,
        y: cameraSpace.y * perspective
    };
};

/**
 * Build a projective Scratch drawable matrix for a flat sprite in Movie's 3D world.
 *
 * Scratch drawables are quads on the local XY plane. Their shader accepts a 4 by 4
 * model matrix, so camera-space depth can be placed in W to give the quad the same
 * perspective division as a 3D plane without rasterizing the sprite into a new skin.
 * This keeps costumes, text, and decoded video frames stampable through scratch-render.
 *
 * @param {object} transform Movie sprite transform
 * @param {object} cameraTransform Movie camera transform
 * @param {Array<number>} skinSize drawable skin width and height
 * @param {Array<number>} rotationCenter drawable rotation center in skin pixels
 * @param {Array<number>} renderedScale Scratch per-axis scale percentages before perspective
 * @returns {Float32Array} column-major projective model matrix
 */
const spritePlaneMatrix = (transform, cameraTransform, skinSize, rotationCenter, renderedScale) => {
    const width = Math.max(0, Number(skinSize && skinSize[0]) || 0);
    const height = Math.max(0, Number(skinSize && skinSize[1]) || 0);
    const centerX = Number.isFinite(Number(rotationCenter && rotationCenter[0])) ?
        Number(rotationCenter[0]) : width / 2;
    const centerY = Number.isFinite(Number(rotationCenter && rotationCenter[1])) ?
        Number(rotationCenter[1]) : height / 2;
    const scratchScaleX = (Number(renderedScale && renderedScale[0]) || 0) / 100;
    const scratchScaleY = (Number(renderedScale && renderedScale[1]) || 0) / 100;
    const transformScale = transform.scale || {};
    const scaleX = modelScale(transformScale.x);
    const scaleY = modelScale(transformScale.y);
    const scaleZ = modelScale(transformScale.z);
    const objectRotation = scratchPlaneObjectRotation.setFromEuler(
        degreesToEuler(transform.rotation, transform.rotationOrder)
    );
    const inverseCameraRotation = scratchPlaneInverseCameraRotation
        .setFromEuler(degreesToEuler(cameraTransform.rotation, cameraTransform.rotationOrder))
        .invert();

    const origin = scratchPlaneOrigin
        .set(
            (centerX - (width / 2)) * scratchScaleX * scaleX,
            -(centerY - (height / 2)) * scratchScaleY * scaleY,
            0
        )
        .applyQuaternion(objectRotation)
        .add(scratchPlaneOffset.set(
            transform.position.x - cameraTransform.position.x,
            transform.position.y - cameraTransform.position.y,
            transform.position.z - cameraTransform.position.z
        ))
        .applyQuaternion(inverseCameraRotation);
    const xAxis = scratchPlaneAxisX.set(-width * scratchScaleX * scaleX, 0, 0)
        .applyQuaternion(objectRotation)
        .applyQuaternion(inverseCameraRotation);
    const yAxis = scratchPlaneAxisY.set(0, -height * scratchScaleY * scaleY, 0)
        .applyQuaternion(objectRotation)
        .applyQuaternion(inverseCameraRotation);
    // The sprite currently has no vertices away from its XY plane, but retaining its transformed Z basis makes
    // set-scale X/Y/Z a complete 3D transform and keeps the matrix ready for non-flat sprite geometry.
    const zAxis = scratchPlaneAxisZ.set(0, 0, scaleZ)
        .applyQuaternion(objectRotation)
        .applyQuaternion(inverseCameraRotation);
    const safeDepth = origin.z > 0.001 ? origin.z : 0.001;
    const focalScale = cameraTransform.focalLength / safeDepth;
    const depthScale = 1 / safeDepth;

    return new Float32Array([
        xAxis.x * focalScale, xAxis.y * focalScale, 0, xAxis.z * depthScale,
        yAxis.x * focalScale, yAxis.y * focalScale, 0, yAxis.z * depthScale,
        zAxis.x * focalScale, zAxis.y * focalScale, 1, zAxis.z * depthScale,
        origin.x * focalScale, origin.y * focalScale, 0, origin.z * depthScale
    ]);
};

const cameraLookAt = (position, target, rotationOrder) => {
    const direction = new THREE.Vector3(
        target.x - position.x,
        target.y - position.y,
        target.z - position.z
    );
    if (direction.lengthSq() < 1e-12) return {x: 0, y: 0, z: 0};
    direction.normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        direction
    );
    const euler = new THREE.Euler().setFromQuaternion(
        quaternion,
        ROTATION_ORDERS.includes(rotationOrder) ? rotationOrder : 'XYZ'
    );
    return {
        x: THREE.MathUtils.radToDeg(euler.x),
        y: THREE.MathUtils.radToDeg(euler.y),
        z: THREE.MathUtils.radToDeg(euler.z)
    };
};

const disposeObject = object => {
    object.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (!child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(material => {
            Object.values(material).forEach(value => {
                if (value && value.isTexture) value.dispose();
            });
            material.dispose();
        });
    });
};

export {
    DEFAULT_BUILDING_MATERIAL,
    DEFAULT_DEPTH,
    DEFAULT_FOCAL_LENGTH,
    DEFAULT_FOV,
    DEFAULT_SHADOW_FAR,
    DEFAULT_STAGE_HEIGHT,
    DEFAULT_STAGE_WIDTH,
    MODEL_DISPLAY_SIZE,
    MODEL_RENDER_SIZE,
    MMD_FRAME_RATE,
    POINT_SHADOW_MAP_SIZE,
    ROTATION_ORDERS,
    SPOT_SHADOW_MAP_SIZE,
    STUDIO_LIGHTING,
    TEXTURE_MIME_TYPES,
    TRANSPARENT_TEXTURE,
    buildingNumber,
    buildingUV,
    buildingZ,
    cameraLookAt,
    createBuildingPrimitive,
    createImagePlane,
    degreesToEuler,
    disposeObject,
    focalLengthFromFOV,
    fovFromFocalLength,
    loadBuildingTexture,
    makeBuildingMaterial,
    makeBuildingPlaneGeometry,
    modelScale,
    moviePositionToThree,
    movieRotationToThreeQuaternion,
    normalizeFOV,
    normalizeLight,
    projectPosition,
    setBuildingUVs,
    spritePlaneMatrix,
    verticalFOVFromFocalLength
};
