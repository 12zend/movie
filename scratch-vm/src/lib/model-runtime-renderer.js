import * as THREE from 'three';

import {
    DEFAULT_DEPTH,
    DEFAULT_SHADOW_FAR,
    MODEL_RENDER_SIZE,
    MMD_FRAME_RATE,
    POINT_SHADOW_MAP_SIZE,
    SPOT_SHADOW_MAP_SIZE,
    STUDIO_LIGHTING,
    degreesToEuler,
    modelScale,
    moviePositionToThree,
    movieRotationToThreeQuaternion,
    normalizeLight,
    verticalFOVFromFocalLength
} from './model-runtime-geometry';
import {
    cloneRenderableObject,
    findSkinnedMesh,
    getMMDAnimationHelperClass
} from './model-runtime-models';

// Preview rendering and world rendering share one renderer instance. The class keeps GPU resources, cloned
// object hierarchies, animation mixers, and the depth export pass alive between calls so a frame only updates
// what actually changed.
const scratchPreviewObjectRotation = new THREE.Quaternion();
const scratchPreviewCameraRotation = new THREE.Quaternion();

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

    // --- Lighting -------------------------------------------------------

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

    // --- Render passes --------------------------------------------------

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

    // --- Object lifetime and animation ---------------------------------

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
            const MMDAnimationHelperClass = getMMDAnimationHelperClass();
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

    // --- Public render entry points -------------------------------------

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

export {ModelRenderer};
