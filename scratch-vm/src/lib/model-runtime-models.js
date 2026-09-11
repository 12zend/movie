import * as THREE from 'three';

import {
    MODEL_DISPLAY_SIZE,
    MMD_FRAME_RATE,
    TEXTURE_MIME_TYPES,
    TRANSPARENT_TEXTURE
} from './model-runtime-geometry';

// Loader modules are intentionally lazy. The editor can use Movie's primitives and projection helpers in
// environments where the optional Three.js loader modules are not available until a model is opened.
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

const getMMDAnimationHelperClass = () => MMDAnimationHelperClass;

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

export {
    attachMotionToGLB,
    bindAnimationToMesh,
    cloneRenderableObject,
    convertModelToGLB,
    disableFullyTransparentMaterials,
    findSkinnedMesh,
    getMMDAnimationHelperClass,
    loadGLBObject,
    restoreMMDBoneHierarchy,
    resampleAnimationClip
};
