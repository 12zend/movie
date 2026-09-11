import * as THREE from 'three';

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

let loaderModulesPromise;
let cloneModelObject = object => object.clone(true);
let MMDAnimationHelperClass = null;

// Image planes never contain bones. Avoid SkeletonUtils' hierarchy walk for the large number of
// text, costume, and procedural planes which can be submitted by one Objects scene.
const cloneRenderableObject = object => (
    object && object.userData && object.userData.movieStaticPlane ? object.clone(true) : cloneModelObject(object)
);

const loadLoaderModules = () => {
    if (!loaderModulesPromise) {
        loaderModulesPromise = Promise.all([
            import('three/examples/jsm/loaders/GLTFLoader.js'),
            import('three/examples/jsm/loaders/FBXLoader.js'),
            import('three/examples/jsm/loaders/OBJLoader.js'),
            import('three/examples/jsm/loaders/MTLLoader.js'),
            import('three/examples/jsm/loaders/MMDLoader.js'),
            import('three/examples/jsm/animation/MMDAnimationHelper.js'),
            import('three/examples/jsm/utils/SkeletonUtils.js'),
            import('three/examples/jsm/exporters/GLTFExporter.js')
        ]).then(([gltf, fbx, obj, mtl, mmd, mmdAnimation, skeletonUtils, exporter]) => {
            cloneModelObject = skeletonUtils.clone;
            MMDAnimationHelperClass = mmdAnimation.MMDAnimationHelper;
            return {
                FBXLoader: fbx.FBXLoader,
                GLTFExporter: exporter.GLTFExporter,
                GLTFLoader: gltf.GLTFLoader,
                MTLLoader: mtl.MTLLoader,
                MMDLoader: mmd.MMDLoader,
                OBJLoader: obj.OBJLoader
            };
        });
    }
    return loaderModulesPromise;
};

const toArrayBuffer = data => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

const parseWithCallback = (loader, data, path = '') => new Promise((resolve, reject) => {
    loader.parse(data, path, resolve, reject);
});

const normalizeObject = object => {
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) throw new Error('The model does not contain renderable geometry.');
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const largestDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largestDimension) || largestDimension <= 0) {
        throw new Error('The model has invalid dimensions.');
    }

    const wrapper = new THREE.Group();
    object.position.sub(center);
    wrapper.add(object);
    wrapper.scale.setScalar(MODEL_DISPLAY_SIZE / largestDimension);
    wrapper.updateMatrixWorld(true);
    return {object: wrapper, originalSize: size};
};

const countGeometry = object => {
    let vertices = 0;
    let triangles = 0;
    object.traverse(child => {
        if (!child.isMesh || !child.geometry) return;
        const positions = child.geometry.getAttribute('position');
        const vertexCount = positions ? positions.count : 0;
        vertices += vertexCount;
        triangles += child.geometry.index ? child.geometry.index.count / 3 : vertexCount / 3;
    });
    return {
        triangles: Math.round(triangles),
        vertices
    };
};

const disableFullyTransparentMaterials = object => {
    object.traverse(child => {
        if (!child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(material => {
            // Three.js still submits transparent materials with zero opacity to the GPU.
            // They cannot contribute a pixel, so omit their geometry groups from rendering.
            if (material && material.transparent && material.opacity <= 0) material.visible = false;
        });
    });
    return object;
};

const exportGLB = async (object, animations) => {
    const {GLTFExporter} = await loadLoaderModules();
    const exporter = new GLTFExporter();
    return new Promise((resolve, reject) => {
        exporter.parse(
            object,
            result => {
                if (!(result instanceof ArrayBuffer)) {
                    reject(new Error('Model conversion did not produce a binary GLB file.'));
                    return;
                }
                resolve(new Uint8Array(result));
            },
            reject,
            {
                binary: true,
                animations,
                onlyVisible: false,
                truncateDrawRange: true
            }
        );
    });
};

const normalizeTexturePath = path => {
    let normalized = String(path || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
    try {
        normalized = decodeURIComponent(normalized);
    } catch (error) {
        // Keep the original path when it contains malformed percent escapes.
    }
    return normalized.toLowerCase();
};

const getTextureMimeType = texture => {
    if (texture.type) return texture.type;
    const path = normalizeTexturePath(texture.path);
    const extension = path.includes('.') ? path.split('.').pop() : '';
    return TEXTURE_MIME_TYPES[extension] || 'application/octet-stream';
};

const makeMMDLoader = (modules, textures = []) => {
    const loadingManager = new THREE.LoadingManager();
    const textureURLs = [];
    const texturesByPath = new Map();
    const texturesByName = new Map();
    textures.forEach(texture => {
        const path = normalizeTexturePath(texture.path);
        if (!path) return;
        texturesByPath.set(path, texture);
        const name = path.split('/').pop();
        if (!texturesByName.has(name)) texturesByName.set(name, []);
        texturesByName.get(name).push(texture);
    });
    loadingManager.setURLModifier(url => {
        if (url.startsWith('data:')) return url;
        const path = normalizeTexturePath(url);
        const nameMatches = texturesByName.get(path.split('/').pop()) || [];
        const texture = texturesByPath.get(path) || (nameMatches.length === 1 ? nameMatches[0] : null);
        if (!texture) return TRANSPARENT_TEXTURE;
        const textureURL = URL.createObjectURL(new Blob([texture.data], {type: getTextureMimeType(texture)}));
        textureURLs.push(textureURL);
        return textureURL;
    });
    return {
        dispose: () => textureURLs.forEach(textureURL => URL.revokeObjectURL(textureURL)),
        loader: new modules.MMDLoader(loadingManager),
        loadingManager
    };
};

const makeGLTFMaterial = material => {
    const color = material && (material.diffuse || material.color);
    const emissive = material && material.emissive;
    return new THREE.MeshStandardMaterial({
        alphaMap: material && material.alphaMap ? material.alphaMap : null,
        color: color && color.isColor ? color.clone() : new THREE.Color(0xffffff),
        emissive: emissive && emissive.isColor ? emissive.clone() : new THREE.Color(0x000000),
        map: material && material.map ? material.map : null,
        metalness: 0,
        opacity: material && Number.isFinite(material.opacity) ? material.opacity : 1,
        roughness: 0.8,
        side: material ? material.side : THREE.FrontSide,
        transparent: Boolean(material && material.transparent)
    });
};

const makePMXObject = async (modules, data, textures) => {
    const {dispose, loader, loadingManager} = makeMMDLoader(modules, textures);
    try {
        const textureLoading = new Promise((resolve, reject) => {
            loadingManager.onLoad = resolve;
            loadingManager.onError = url => reject(new Error(`Could not decode PMX texture: ${url}`));
        });
        const parsed = loader._getParser().parsePmx(toArrayBuffer(data), true);
        const mesh = loader.meshBuilder.build(parsed, '', null, () => {});
        await textureLoading;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.material = Array.isArray(mesh.material) ?
            materials.map(makeGLTFMaterial) : makeGLTFMaterial(materials[0]);
        materials.forEach(material => material.dispose());
        return {dispose, object: mesh};
    } catch (error) {
        dispose();
        throw error;
    }
};

const parseSourceModel = async (format, data, mtlData, textures) => {
    const modules = await loadLoaderModules();
    if (format === 'glb') {
        const gltf = await parseWithCallback(new modules.GLTFLoader(), toArrayBuffer(data));
        return {
            animations: gltf.animations || [],
            object: gltf.scene
        };
    }
    if (format === 'fbx') {
        const object = new modules.FBXLoader().parse(toArrayBuffer(data), '');
        return {
            animations: object.animations || [],
            object
        };
    }
    if (format === 'obj') {
        const loader = new modules.OBJLoader();
        if (mtlData) {
            const materials = new modules.MTLLoader().parse(new TextDecoder().decode(mtlData), '');
            materials.preload();
            loader.setMaterials(materials);
        }
        return {
            animations: [],
            object: loader.parse(new TextDecoder().decode(data))
        };
    }
    if (format === 'pmx') {
        const pmx = await makePMXObject(modules, data, textures);
        return {
            animations: [],
            dispose: pmx.dispose,
            object: pmx.object
        };
    }
    throw new Error('Supported model formats are GLB, PMX, FBX, and OBJ/MTL.');
};

const unusedAnimationName = (requestedName, animations) => {
    const names = animations.map(animation => animation.name.toLowerCase());
    if (!names.includes(requestedName.toLowerCase())) return requestedName;
    let index = 2;
    while (names.includes(`${requestedName}${index}`.toLowerCase())) index++;
    return `${requestedName}${index}`;
};

const convertModelToGLB = async (format, data, mtlData, textures) => {
    const parsed = await parseSourceModel(format, data, mtlData, textures);
    try {
        const normalized = normalizeObject(parsed.object);
        const geometry = countGeometry(normalized.object);
        const animations = [];
        parsed.animations.forEach((animation, index) => {
            animation.name = unusedAnimationName(animation.name || `Animation ${index + 1}`, animations);
            animations.push(animation);
        });
        const glb = await exportGLB(normalized.object, animations);
        return {
            activeMotion: animations.length ? animations[0].name : '',
            animationCount: animations.length,
            glb,
            motions: animations.map(animation => ({
                format,
                frameCount: Math.max(1, Math.round(animation.duration * MMD_FRAME_RATE) + 1),
                name: animation.name
            })),
            originalSize: {
                x: normalized.originalSize.x,
                y: normalized.originalSize.y,
                z: normalized.originalSize.z
            },
            ...geometry
        };
    } finally {
        if (parsed.dispose) parsed.dispose();
    }
};

const findSkinnedMesh = object => {
    let result = null;
    object.traverse(child => {
        if (!result && child.isSkinnedMesh && child.skeleton) result = child;
    });
    return result;
};

const restoreMMDBoneHierarchy = object => {
    const mesh = findSkinnedMesh(object);
    if (!mesh || !mesh.geometry.userData.MMD) return mesh;
    const bones = new Set(mesh.skeleton.bones);
    const rootBones = mesh.skeleton.bones.filter(bone => !bones.has(bone.parent));
    object.updateMatrixWorld(true);
    rootBones.forEach(rootBone => {
        let ancestor = mesh;
        while (ancestor && ancestor !== rootBone) ancestor = ancestor.parent;
        if (ancestor !== rootBone && rootBone.parent !== mesh) mesh.attach(rootBone);
    });
    object.updateMatrixWorld(true);
    return mesh;
};

const resampleAnimationClip = (clip, frameRate = MMD_FRAME_RATE) => {
    const lastFrame = Math.max(0, Math.round(clip.duration * frameRate));
    const times = [];
    for (let frame = 0; frame <= lastFrame; frame++) times.push(frame / frameRate);
    const tracks = clip.tracks.map(track => {
        const values = [];
        const interpolant = track.createInterpolant();
        times.forEach(time => values.push(...interpolant.evaluate(time)));
        return new track.constructor(track.name, times, values, THREE.InterpolateLinear);
    });
    return new THREE.AnimationClip(clip.name, lastFrame / frameRate, tracks);
};

const bindAnimationToMesh = (clip, mesh) => {
    const targetName = THREE.PropertyBinding.sanitizeNodeName(mesh.name || mesh.uuid);
    mesh.name = targetName;
    clip.tracks.forEach(track => {
        if (track.name.startsWith('.')) track.name = `${targetName}${track.name}`;
    });
    return clip;
};

const loadGLBObject = async data => {
    const {GLTFLoader} = await loadLoaderModules();
    const gltf = await parseWithCallback(new GLTFLoader(), toArrayBuffer(data));
    gltf.scene.animations = gltf.animations || [];
    restoreMMDBoneHierarchy(gltf.scene);
    disableFullyTransparentMaterials(gltf.scene);
    return gltf.scene;
};

const decodeVPD = (data, mesh, loader) => {
    const bytes = toArrayBuffer(data);
    const decodings = ['shift-jis', 'utf-8'];
    let best = null;
    let bestMatches = -1;
    const boneNames = new Set(mesh.skeleton.bones.map(bone => bone.name));
    for (const encoding of decodings) {
        try {
            const parsed = loader._getParser().parseVpd(new TextDecoder(encoding).decode(bytes), true);
            const matches = parsed.bones.reduce((count, bone) => count + (boneNames.has(bone.name) ? 1 : 0), 0);
            if (matches > bestMatches) {
                best = parsed;
                bestMatches = matches;
            }
        } catch (e) { // Try the other common VPD encoding.
            // Intentionally empty.
        }
    }
    if (!best) throw new Error('The VPD pose could not be decoded.');
    return best;
};

const makeVPDClip = (data, mesh, loader) => {
    const vpd = decodeVPD(data, mesh, loader);
    const bones = new Map(mesh.skeleton.bones.map(bone => [bone.name, bone]));
    const tracks = [];
    for (const pose of vpd.bones) {
        const bone = bones.get(pose.name);
        if (!bone) continue;
        const position = bone.position.clone().add(new THREE.Vector3().fromArray(pose.translation));
        const quaternion = bone.quaternion.clone().multiply(new THREE.Quaternion().fromArray(pose.quaternion));
        const trackName = `.bones[${pose.name}]`;
        tracks.push(new THREE.VectorKeyframeTrack(`${trackName}.position`, [0], position.toArray()));
        tracks.push(new THREE.QuaternionKeyframeTrack(`${trackName}.quaternion`, [0], quaternion.toArray()));
    }
    if (!tracks.length) throw new Error('The VPD pose does not match any bones in this model.');
    return new THREE.AnimationClip('', 1 / MMD_FRAME_RATE, tracks);
};

const attachMotionToGLB = async (modelData, motionData, format, requestedName) => {
    const modules = await loadLoaderModules();
    const gltf = await parseWithCallback(new modules.GLTFLoader(), toArrayBuffer(modelData));
    const mesh = restoreMMDBoneHierarchy(gltf.scene) || findSkinnedMesh(gltf.scene);
    if (!mesh) throw new Error('VMD/VPD files require a rigged model with bones.');
    const {dispose, loader} = makeMMDLoader(modules);
    try {
        let clip;
        if (format === 'vmd') {
            const vmd = loader._getParser().parseVmd(toArrayBuffer(motionData), true);
            clip = resampleAnimationClip(loader.animationBuilder.build(vmd, mesh));
        } else if (format === 'vpd') {
            clip = makeVPDClip(motionData, mesh, loader);
        } else {
            throw new Error('Supported model motion formats are VMD and VPD.');
        }
        bindAnimationToMesh(clip, mesh);
        if (!clip.tracks.length) throw new Error(`The ${format.toUpperCase()} file does not match this model.`);
        const animations = gltf.animations || [];
        clip.name = unusedAnimationName(requestedName || format.toUpperCase(), animations);
        const nextAnimations = animations.concat(clip);
        const glb = await exportGLB(gltf.scene, nextAnimations);
        return {
            activeMotion: clip.name,
            animationCount: nextAnimations.length,
            glb,
            motion: {
                format,
                frameCount: format === 'vpd' ? 1 :
                    Math.max(1, Math.round(clip.duration * MMD_FRAME_RATE) + 1),
                name: clip.name
            }
        };
    } finally {
        dispose();
    }
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
const scratchPreviewObjectRotation = new THREE.Quaternion();
const scratchPreviewCameraRotation = new THREE.Quaternion();

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

class ModelRenderer {
    constructor (canvas) {
        this.canvas = canvas || document.createElement('canvas');
        this.canvas.width = MODEL_RENDER_SIZE;
        this.canvas.height = MODEL_RENDER_SIZE;
        this.canvas.reusable = false;
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            // Movie already renders at the configured bitmap resolution. Disabling MSAA avoids a second
            // full-frame color/depth sample set and is considerably faster for video and text planes.
            antialias: false,
            canvas: this.canvas,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true
        });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(MODEL_RENDER_SIZE, MODEL_RENDER_SIZE, false);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.shadowMap.enabled = false;
        this.renderer.shadowMap.autoUpdate = false;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Render the scene into a color target with a real GPU depth attachment. The depth attachment is packed
        // into depthCanvas for consumers which use another WebGL context (notably Pen FX). The model's color is
        // rendered directly to the public canvas after this pass, avoiding a fragile color-copy shader.
        this.renderTarget = new THREE.WebGLRenderTarget(MODEL_RENDER_SIZE, MODEL_RENDER_SIZE, {
            depthBuffer: true,
            format: THREE.RGBAFormat,
            magFilter: THREE.LinearFilter,
            minFilter: THREE.LinearFilter,
            stencilBuffer: false
        });
        // Non-XR render targets are rendered in linear space by Three.js. Keep the attachment linear so sampling
        // it never applies an implicit sRGB conversion before the result is displayed on the public canvas.
        this.renderTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
        this.renderTarget.texture.generateMipmaps = false;
        this.renderTarget.depthTexture = new THREE.DepthTexture(
            MODEL_RENDER_SIZE,
            MODEL_RENDER_SIZE,
            THREE.UnsignedIntType
        );
        this.renderTarget.depthTexture.magFilter = THREE.NearestFilter;
        this.renderTarget.depthTexture.minFilter = THREE.NearestFilter;
        // The render target follows the non-MSAA context. Resolving a 4x target before every canvas copy
        // costs more than it improves the stage-sized Movie output.
        this.renderTarget.samples = 0;

        this.depthCanvas = document.createElement('canvas');
        this.depthCanvas.width = MODEL_RENDER_SIZE;
        this.depthCanvas.height = MODEL_RENDER_SIZE;
        this.depthCanvas.reusable = false;
        this.depthContext = this.depthCanvas.getContext('2d', {alpha: false});
        this.depthVersion = 0;

        const screenGeometry = new THREE.PlaneGeometry(2, 2);
        this.screenScene = new THREE.Scene();
        this.screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.depthCopyMaterial = new THREE.ShaderMaterial({
            blending: THREE.NoBlending,
            depthTest: false,
            depthWrite: false,
            uniforms: {u_depth: {value: this.renderTarget.depthTexture}},
            vertexShader: `
                varying vec2 v_uv;
                void main() {
                    v_uv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 v_uv;
                uniform sampler2D u_depth;

                vec3 packDepth(float value) {
                    vec3 encodedDepth = fract(value * vec3(1.0, 255.0, 65025.0));
                    encodedDepth -= encodedDepth.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);
                    return encodedDepth;
                }

                void main() {
                    float depth = texture2D(u_depth, v_uv).x;
                    gl_FragColor = depth >= 0.999999 ? vec4(1.0) : vec4(packDepth(depth), 1.0);
                }
            `
        });
        this.screenQuad = new THREE.Mesh(screenGeometry, this.depthCopyMaterial);
        this.screenQuad.frustumCulled = false;
        this.screenScene.add(this.screenQuad);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
        this.camera.position.set(0, 0, 310);
        this.camera.lookAt(0, 0, 0);
        this.lightObjects = [];
        this.lightConfiguration = {};
        this.usesShadows = false;
        this.setLights(null);

        // Keep cloned scene objects and their animation mixers alive between frames. A PMX model can have
        // hundreds of bones, so cloning its hierarchy and rebuilding the mixer for every frame is substantially
        // more expensive than updating the pose of an existing clone.
        this.currentObjects = [];
        this.currentSources = [];
        this.currentAnimationNames = [];
        this.currentFrames = [];
        this.sourceIds = new WeakMap();
        this.nextSourceId = 1;
        this.depthBounds = new THREE.Box3();
        this.depthPoint = new THREE.Vector3();
        this.lastRenderKey = null;
        this.lastRenderWasCached = false;
        this.renderVersion = 0;
        this.animationStates = new WeakMap();
        this.lightsKeySource = null;
        this.lightsKeyValue = 'studio';
    }

    invalidateRenderCache () {
        this.lastRenderKey = null;
    }

    getSourceId (source) {
        if (!source || typeof source !== 'object') return String(source);
        if (!this.sourceIds) this.sourceIds = new WeakMap();
        let id = this.sourceIds.get(source);
        if (!id) {
            id = this.nextSourceId || 1;
            this.nextSourceId = id + 1;
            this.sourceIds.set(source, id);
        }
        return id;
    }

    getLightsKey (lights) {
        if (!Array.isArray(lights)) return 'studio';
        // Light configurations are compared by identity in setLights, so serializing them again only
        // when the array identity changes produces the same key while skipping a per-frame JSON pass.
        if (this.lightsKeySource !== lights) {
            this.lightsKeySource = lights;
            this.lightsKeyValue = JSON.stringify(lights);
        }
        return this.lightsKeyValue;
    }

    getRenderCacheKey (sceneItems, cameraTransform, width, height, bitmapResolution, lights) {
        const camera = cameraTransform || {};
        const position = camera.position || {};
        const rotation = camera.rotation || {};
        const parts = [
            width,
            height,
            bitmapResolution,
            camera.focalLength,
            camera.rotationOrder,
            position.x,
            position.y,
            position.z,
            rotation.x,
            rotation.y,
            rotation.z,
            this.getLightsKey(lights)
        ];
        for (const item of sceneItems || []) {
            const transform = item.transform || {};
            const itemPosition = transform.position || {};
            const itemRotation = transform.rotation || {};
            const scale = transform.scale || {};
            parts.push(
                this.getSourceId(item.sourceObject),
                item.animationName,
                item.frame,
                transform.rotationOrder,
                transform.size,
                transform.worldX,
                transform.worldY,
                transform.worldZ,
                itemPosition.x,
                itemPosition.y,
                itemPosition.z,
                itemRotation.x,
                itemRotation.y,
                itemRotation.z,
                scale.x,
                scale.y,
                scale.z
            );
        }
        return parts.join('|');
    }

    clearLightObjects () {
        (this.lightObjects || []).forEach(object => {
            this.scene.remove(object);
            if (object.shadow && object.shadow.map) object.shadow.map.dispose();
        });
        this.lightObjects = [];
    }

    addLightObject (light) {
        this.scene.add(light);
        this.lightObjects.push(light);
        if (light.target) {
            this.scene.add(light.target);
            this.lightObjects.push(light.target);
        }
    }

    makeLight (configuration, intensity, castShadow) {
        const color = new THREE.Color();
        try {
            color.set(configuration.color || 0xffffff);
        } catch (error) {
            color.set(0xffffff);
        }
        let light;
        if (configuration.type === 'spot') {
            light = new THREE.SpotLight(
                color,
                intensity,
                configuration.radius,
                THREE.MathUtils.degToRad(configuration.angle),
                0.2,
                2
            );
            light.target.position.set(0, 0, -DEFAULT_DEPTH);
            light.shadow.mapSize.set(SPOT_SHADOW_MAP_SIZE, SPOT_SHADOW_MAP_SIZE);
        } else {
            light = new THREE.PointLight(color, intensity, configuration.radius, 2);
            light.shadow.mapSize.set(POINT_SHADOW_MAP_SIZE, POINT_SHADOW_MAP_SIZE);
        }
        light.position.copy(moviePositionToThree(configuration.position));
        light.castShadow = castShadow;
        if (castShadow) {
            light.shadow.bias = -0.0005;
            light.shadow.normalBias = 0.5;
            light.shadow.radius = 2;
            light.shadow.camera.near = 0.5;
            light.shadow.camera.far = Math.max(1, configuration.radius || DEFAULT_SHADOW_FAR);
            light.shadow.camera.updateProjectionMatrix();
        }
        return light;
    }

    setObjectShadowState (object) {
        object.traverse(child => {
            if (!child.isMesh) return;
            child.castShadow = this.usesShadows;
            child.receiveShadow = this.usesShadows;
        });
    }

    setLights (requestedLights) {
        if (this.lightConfiguration === requestedLights) return;
        this.lightConfiguration = requestedLights;
        this.invalidateRenderCache();
        this.clearLightObjects();

        // A null configuration keeps existing projects and model previews using the original studio lighting.
        if (Array.isArray(requestedLights)) {
            const configurations = requestedLights.map(normalizeLight);
            this.usesShadows = configurations.some(light => light.shadow > 0 && light.intensity > 0);
            configurations.forEach(configuration => {
                // Split a partially shadowed light into a shadow-casting and an unshadowed contribution. This
                // keeps the lit intensity constant while making 0 fully unshadowed and 1 maximally dark.
                const shadowedIntensity = configuration.intensity * configuration.shadow;
                const unshadowedIntensity = configuration.intensity - shadowedIntensity;
                if (unshadowedIntensity > 0) {
                    this.addLightObject(this.makeLight(configuration, unshadowedIntensity, false));
                }
                if (shadowedIntensity > 0) {
                    this.addLightObject(this.makeLight(configuration, shadowedIntensity, true));
                }
            });
        } else {
            const studioHemisphere = STUDIO_LIGHTING.hemisphere;
            this.addLightObject(new THREE.HemisphereLight(
                studioHemisphere.skyColor,
                studioHemisphere.groundColor,
                studioHemisphere.intensity
            ));
            const studioKey = STUDIO_LIGHTING.directional[0];
            const keyLight = new THREE.DirectionalLight(studioKey.color, studioKey.intensity);
            keyLight.position.set(studioKey.position.x, studioKey.position.y, studioKey.position.z);
            this.addLightObject(keyLight);
            const studioFill = STUDIO_LIGHTING.directional[1];
            const fillLight = new THREE.DirectionalLight(studioFill.color, studioFill.intensity);
            fillLight.position.set(studioFill.position.x, studioFill.position.y, studioFill.position.z);
            this.addLightObject(fillLight);
            this.usesShadows = false;
        }
        if (this.renderer.shadowMap) this.renderer.shadowMap.enabled = this.usesShadows;
        (this.currentObjects || []).forEach(object => this.setObjectShadowState(object));
    }

    setOutputSize (width, height) {
        if (this.canvas.width === width && this.canvas.height === height) return;
        this.invalidateRenderCache();
        this.renderer.setSize(width, height, false);
        if (this.renderTarget) this.renderTarget.setSize(width, height);
        if (this.depthCanvas) {
            this.depthCanvas.width = width;
            this.depthCanvas.height = height;
            this.depthCanvas.reusable = false;
        }
        this.canvas.reusable = false;
    }

    updateCameraDepthRange () {
        this.camera.updateMatrixWorld(true);
        const bounds = this.depthBounds || (this.depthBounds = new THREE.Box3());
        const point = this.depthPoint || (this.depthPoint = new THREE.Vector3());
        let closest = Infinity;
        let farthest = 0;
        let containsCamera = false;
        for (const object of this.currentObjects) {
            bounds.setFromObject(object);
            if (bounds.isEmpty()) continue;
            containsCamera = containsCamera || bounds.containsPoint(this.camera.position);
            for (let index = 0; index < 8; index++) {
                point.set(
                    index & 1 ? bounds.max.x : bounds.min.x,
                    index & 2 ? bounds.max.y : bounds.min.y,
                    index & 4 ? bounds.max.z : bounds.min.z
                ).applyMatrix4(this.camera.matrixWorldInverse);
                const depth = -point.z;
                if (depth > 0) {
                    closest = Math.min(closest, depth);
                    farthest = Math.max(farthest, depth);
                }
            }
        }
        if (!Number.isFinite(closest) || farthest <= 0) {
            this.camera.near = 0.1;
            this.camera.far = 10000000;
            return;
        }
        const span = Math.max(1, farthest - closest);
        const margin = Math.max(1, span * 0.05);
        // A room/shell can surround the camera. In that case the nearest visible surface is inside the AABB, so
        // using only its forward-facing corners produces a near plane in the middle of the room and clips it when
        // the camera rotates. Keep the near plane close whenever an object's bounds contain the camera.
        if (containsCamera) {
            this.camera.near = 0.1;
            this.camera.far = Math.max(this.camera.near + 1, farthest + margin);
            return;
        }
        this.camera.near = Math.max(0.01, closest - margin);
        this.camera.far = Math.max(this.camera.near + 1, farthest + margin);
    }

    renderSceneWithZBuffer () {
        if (!this.renderTarget || typeof this.renderer.setRenderTarget !== 'function') {
            return this.renderer.render(this.scene, this.camera);
        }
        const outputColorSpace = this.renderer.outputColorSpace;
        let depthCopied = false;
        try {
            this.renderer.setRenderTarget(this.renderTarget);
            this.renderer.clear();
            this.renderer.render(this.scene, this.camera);
            this.renderer.setRenderTarget(null);

            // Depth bytes must not pass through an sRGB transfer curve: Pen FX decodes these exact RGB values.
            this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
            this.screenQuad.material = this.depthCopyMaterial;
            this.renderer.render(this.screenScene, this.screenCamera);
            if (this.depthContext) {
                this.depthContext.drawImage(this.canvas, 0, 0, this.depthCanvas.width, this.depthCanvas.height);
                depthCopied = true;
            }
        } catch (error) {
            // Depth export is auxiliary. A failure here must not prevent the model from being shown on the
            // public canvas, which is also the color source used by the Movie renderer.
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn('Movie 3D depth export failed; rendering the model directly.', error);
            }
        } finally {
            this.renderer.setRenderTarget(null);
            this.renderer.outputColorSpace = outputColorSpace;
        }

        // Render the authoritative color image directly to the public canvas. Copying the render target through
        // a second shader is fragile across Three.js revisions and can turn a valid scene into a blank canvas when
        // the copy program fails to compile.
        this.renderer.render(this.scene, this.camera);
        if (depthCopied) this.depthVersion++;
    }

    getDepthBuffer () {
        if (!this.depthCanvas) return null;
        return {
            canvas: this.depthCanvas,
            far: this.camera.far,
            height: this.depthCanvas.height,
            near: this.camera.near,
            version: this.depthVersion,
            width: this.depthCanvas.width
        };
    }

    setObject (sourceObject, animationName, frame) {
        this.syncObjects([{animationName, frame, sourceObject}]);
        this.currentObject = this.currentObjects[0];
        return this.currentObject;
    }

    applyAnimation (object, animationName, frame) {
        if (!animationName || !Array.isArray(object.animations)) return;
        const clip = THREE.AnimationClip.findByName(object.animations, animationName);
        if (!clip) return;
        const requestedTime = (Math.max(1, Number(frame) || 1) - 1) / MMD_FRAME_RATE;
        const animationTime = Math.min(requestedTime, Math.max(0, clip.duration));
        let state = this.animationStates.get(object);
        if (!state) {
            const mmdMesh = findSkinnedMesh(object);
            if (MMDAnimationHelperClass && mmdMesh && mmdMesh.geometry.userData.MMD) {
                try {
                    const helper = new MMDAnimationHelperClass({pmxAnimation: true, sync: false});
                    helper.add(mmdMesh, {animation: clip, physics: false});
                    const mixer = helper.objects.get(mmdMesh).mixer;
                    const action = mixer.clipAction(clip);
                    action.setLoop(THREE.LoopOnce, 1);
                    action.clampWhenFinished = true;
                    state = {helper, mixer, mmdMesh};
                } catch (error) {
                    // Fall through to ordinary skeletal animation if optional MMD metadata is incomplete.
                }
            }
            if (!state) {
                const mixer = new THREE.AnimationMixer(object);
                const action = mixer.clipAction(clip);
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
                action.play();
                state = {mixer};
            }
            this.animationStates.set(object, state);
        }
        state.mixer.setTime(animationTime);
        if (state.helper) state.helper._animateMesh(state.mmdMesh, 0);
        object.updateMatrixWorld(true);
    }

    removeObject (object) {
        const animationState = this.animationStates.get(object);
        if (animationState) {
            animationState.mixer.stopAllAction();
            if (animationState.helper) animationState.helper.remove(animationState.mmdMesh);
            this.animationStates.delete(object);
        }
        this.scene.remove(object);
    }

    syncObjects (sceneItems) {
        if (!Array.isArray(this.currentFrames)) this.currentFrames = [];
        for (let index = 0; index < sceneItems.length; index++) {
            const item = sceneItems[index];
            const canReuse = this.currentSources[index] === item.sourceObject &&
                this.currentAnimationNames[index] === item.animationName;
            if (!canReuse) {
                if (this.currentObjects[index]) this.removeObject(this.currentObjects[index]);
                const object = cloneRenderableObject(item.sourceObject);
                this.currentObjects[index] = object;
                this.currentSources[index] = item.sourceObject;
                this.currentAnimationNames[index] = item.animationName;
                this.scene.add(object);
                this.setObjectShadowState(object);
            }
            if (this.currentFrames[index] !== item.frame || !canReuse) {
                this.applyAnimation(this.currentObjects[index], item.animationName, item.frame);
            }
            this.currentFrames[index] = item.frame;
        }
        for (let index = sceneItems.length; index < this.currentObjects.length; index++) {
            this.removeObject(this.currentObjects[index]);
        }
        this.currentObjects.length = sceneItems.length;
        this.currentSources.length = sceneItems.length;
        this.currentAnimationNames.length = sceneItems.length;
        this.currentFrames.length = sceneItems.length;
        this.currentObject = this.currentObjects.length === 1 ? this.currentObjects[0] : null;
        return this.currentObjects;
    }

    clearObjects () {
        if (this.imagePlaneBatches) this.imagePlaneBatches.forEach(batch => batch.dispose());
        this.imagePlaneBatches = [];
        if (this.currentObjects) this.currentObjects.forEach(object => this.removeObject(object));
        this.invalidateRenderCache();
        this.currentObject = null;
        this.currentObjects = [];
        this.currentSources = [];
        this.currentAnimationNames = [];
        this.currentFrames = [];
    }

    render (sourceObject, transform, cameraTransform, animationName, frame) {
        this.setOutputSize(MODEL_RENDER_SIZE, MODEL_RENDER_SIZE);
        this.setObject(sourceObject, animationName, frame);
        this.currentObject.position.set(0, 0, 0);
        this.currentObject.scale.set(1, 1, 1);
        const objectQuaternion = scratchPreviewObjectRotation.setFromEuler(
            degreesToEuler(transform.rotation, transform.rotationOrder)
        );
        const cameraQuaternion = scratchPreviewCameraRotation.setFromEuler(
            degreesToEuler(cameraTransform.rotation, cameraTransform.rotationOrder)
        );
        this.currentObject.quaternion.copy(cameraQuaternion.invert().multiply(objectQuaternion));
        this.camera.fov = 38;
        this.camera.aspect = 1;
        this.camera.position.set(0, 0, 310);
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();
        this.renderer.render(this.scene, this.camera);
        return this.canvas;
    }

    renderWorld (sourceObject, transform, cameraTransform, stageSize, bitmapResolution = 2) {
        return this.renderWorldScene([{
            sourceObject,
            transform
        }], cameraTransform, stageSize, bitmapResolution);
    }

    renderInstancedImagePlanes () {
        const batches = this.imagePlaneBatches || (this.imagePlaneBatches = []);
        const hidden = [];
        let batchCount = 0;
        try {
            for (let start = 0; start < this.currentObjects.length;) {
                const first = this.currentObjects[start];
                const eligible = object => object && object.isMesh && object.visible &&
                    object.userData.movieStaticPlane && object.scale.x > 0 && object.scale.y > 0 && object.scale.z > 0;
                if (!eligible(first)) {
                    start++;
                    continue;
                }
                let end = start + 1;
                while (end < this.currentObjects.length) {
                    const object = this.currentObjects[end];
                    if (!eligible(object) || object.geometry !== first.geometry ||
                        object.material !== first.material) break;
                    end++;
                }
                const count = end - start;
                if (count > 1) {
                    let batch = batches[batchCount];
                    if (!batch || batch.geometry !== first.geometry || batch.material !== first.material ||
                        batch.instanceMatrix.count < count) {
                        if (batch) batch.dispose();
                        batch = new THREE.InstancedMesh(first.geometry, first.material, count);
                        batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                        // Bounds are already evaluated on the individual planes for the camera depth range.
                        batch.frustumCulled = false;
                        batches[batchCount] = batch;
                    }
                    batch.count = count;
                    batch.castShadow = first.castShadow;
                    batch.receiveShadow = first.receiveShadow;
                    for (let index = start; index < end; index++) {
                        const object = this.currentObjects[index];
                        object.updateMatrix();
                        batch.setMatrixAt(index - start, object.matrix);
                        object.visible = false;
                        hidden.push(object);
                    }
                    batch.instanceMatrix.needsUpdate = true;
                    this.scene.add(batch);
                    batchCount++;
                }
                start = end;
            }
            return this.renderSceneWithZBuffer();
        } finally {
            hidden.forEach(object => {
                object.visible = true;
            });
            batches.forEach((batch, index) => {
                this.scene.remove(batch);
                if (index >= batchCount) batch.dispose();
            });
            batches.length = batchCount;
        }
    }

    renderWorldScene (sceneItems, cameraTransform, stageSize, bitmapResolution = 2, lights = null) {
        const width = Math.max(1, stageSize[0]);
        const height = Math.max(1, stageSize[1]);
        this.setOutputSize(Math.round(width * bitmapResolution), Math.round(height * bitmapResolution));
        this.setLights(lights);
        const renderKey = this.getRenderCacheKey(
            sceneItems,
            cameraTransform,
            width,
            height,
            bitmapResolution,
            lights
        );
        if (this.lastRenderKey === renderKey) {
            this.lastRenderWasCached = true;
            return this.canvas;
        }
        this.lastRenderWasCached = false;
        this.syncObjects(sceneItems);
        this.currentObjects.forEach((object, index) => {
            const item = sceneItems[index];
            const transform = item.transform;
            object.position.copy(moviePositionToThree({
                x: transform.worldX,
                y: transform.worldY,
                z: transform.worldZ
            }));
            object.quaternion.copy(movieRotationToThreeQuaternion(
                transform.rotation,
                transform.rotationOrder
            ));
            const scale = Math.max(0, Number(transform.size) || 0) / 100;
            const transformScale = transform.scale || {};
            object.scale.set(
                scale * modelScale(transformScale.x),
                scale * modelScale(transformScale.y),
                scale * modelScale(transformScale.z)
            );
        });

        this.camera.fov = verticalFOVFromFocalLength(cameraTransform.focalLength, height);
        this.camera.aspect = width / height;
        this.camera.near = 0.1;
        this.camera.far = 10000000;
        this.camera.position.copy(moviePositionToThree(cameraTransform.position));
        this.camera.quaternion.copy(movieRotationToThreeQuaternion(
            cameraTransform.rotation,
            cameraTransform.rotationOrder
        ));
        this.updateCameraDepthRange();
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld(true);

        if (this.usesShadows && this.renderer.shadowMap) this.renderer.shadowMap.needsUpdate = true;
        this.renderInstancedImagePlanes();
        this.lastRenderKey = renderKey;
        this.renderVersion++;
        return this.canvas;
    }

    dispose () {
        this.clearObjects();
        this.clearLightObjects();
        if (this.renderTarget) this.renderTarget.dispose();
        if (this.screenQuad && this.screenQuad.geometry) this.screenQuad.geometry.dispose();
        if (this.depthCopyMaterial) this.depthCopyMaterial.dispose();
        this.renderer.dispose();
    }
}

export {
    DEFAULT_DEPTH,
    DEFAULT_FOV,
    DEFAULT_FOCAL_LENGTH,
    DEFAULT_STAGE_HEIGHT,
    DEFAULT_STAGE_WIDTH,
    STUDIO_LIGHTING,
    ROTATION_ORDERS,
    ModelRenderer,
    attachMotionToGLB,
    bindAnimationToMesh,
    cameraLookAt,
    convertModelToGLB,
    createBuildingPrimitive,
    createImagePlane,
    disableFullyTransparentMaterials,
    disposeObject,
    focalLengthFromFOV,
    fovFromFocalLength,
    loadGLBObject,
    loadBuildingTexture,
    makeBuildingMaterial,
    moviePositionToThree,
    movieRotationToThreeQuaternion,
    normalizeLight,
    normalizeFOV,
    projectPosition,
    spritePlaneMatrix,
    resampleAnimationClip,
    restoreMMDBoneHierarchy,
    verticalFOVFromFocalLength
};
