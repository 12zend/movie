import * as THREE from 'three';

import {
    DEFAULT_FOCAL_LENGTH,
    ModelRenderer,
    bindAnimationToMesh,
    cameraLookAt,
    createBuildingPrimitive,
    createImagePlane,
    disableFullyTransparentMaterials,
    focalLengthFromFOV,
    fovFromFocalLength,
    moviePositionToThree,
    movieRotationToThreeQuaternion,
    normalizeLight,
    projectPosition,
    resampleAnimationClip,
    restoreMMDBoneHierarchy,
    verticalFOVFromFocalLength
} from '../../../src/lib/model-runtime';

const camera = {
    focalLength: DEFAULT_FOCAL_LENGTH,
    position: {x: 0, y: 0, z: 0},
    rotation: {x: 0, y: 0, z: 0},
    rotationOrder: 'XYZ'
};

describe('Movie 3D projection', () => {
    test('uses depth-tested opaque-pass image planes instead of transparent painter ordering', () => {
        const texture = new THREE.Texture();
        const plane = createImagePlane(texture, 100, 50, {x: 25, y: 10});
        plane.geometry.computeBoundingBox();

        expect(plane.material.transparent).toBe(false);
        expect(plane.material.depthTest).toBe(true);
        expect(plane.material.depthWrite).toBe(true);
        expect(plane.material.alphaTest).toBeCloseTo(1 / 255);
        expect(plane.material.map).not.toBe(texture);
        expect(plane.geometry.boundingBox.min.toArray()).toEqual([-25, -40, 0]);
        expect(plane.geometry.boundingBox.max.toArray()).toEqual([75, 10, 0]);

        plane.material.map.dispose();
        plane.material.dispose();
        plane.geometry.dispose();
        texture.dispose();
    });

    test('builds a diagonal wall with height and repeatable UV coordinates', () => {
        const wall = createBuildingPrimitive('wall', {
            x1: 0,
            y1: 0,
            z1: 0,
            x2: 100,
            y2: 100,
            z2: 100
        }, {u1: 0, v1: 0, u2: 10, v2: 2});

        expect(Array.from(wall.geometry.getAttribute('position').array)).toEqual([
            0, 0, 0,
            100, 0, -100,
            100, 100, -100,
            0, 100, 0
        ]);
        expect(Array.from(wall.geometry.getAttribute('uv').array)).toEqual([
            0, 0,
            10, 0,
            10, 2,
            0, 2
        ]);
        expect(wall.material.color.getHexString()).toBe('ff00ff');
        expect(wall.material.emissive.getHexString()).toBe('000000');
        expect(wall.material.roughness).toBe(1);
        expect(wall.material.ior).toBe(1.45);
    });

    test('builds a floor whose height slopes along the z axis', () => {
        const floor = createBuildingPrimitive('floor', {
            x1: 0,
            y1: 0,
            z1: 0,
            x2: 100,
            y2: 50,
            z2: 100
        }, {u1: 0, v1: 0, u2: 1, v2: 1});

        expect(Array.from(floor.geometry.getAttribute('position').array)).toEqual([
            0, 0, 0,
            100, 0, 0,
            100, 50, -100,
            0, 50, -100
        ]);
    });

    test('maps the requested UV range onto every face of a box', () => {
        const box = createBuildingPrimitive('box', {
            x1: 0,
            y1: 0,
            z1: 0,
            x2: 100,
            y2: 50,
            z2: 20
        }, {u1: 2, v1: 3, u2: 12, v2: 8});
        const uv = Array.from(box.geometry.getAttribute('uv').array);

        expect(Math.min(...uv.filter((value, index) => index % 2 === 0))).toBe(2);
        expect(Math.max(...uv.filter((value, index) => index % 2 === 0))).toBe(12);
        expect(Math.min(...uv.filter((value, index) => index % 2 === 1))).toBe(3);
        expect(Math.max(...uv.filter((value, index) => index % 2 === 1))).toBe(8);
    });

    test('normalizes user light inputs and clamps fractional shadow strength', () => {
        expect(normalizeLight({
            angle: 180,
            color: '#ff8040',
            intensity: -2,
            position: {x: '10', y: 'invalid', z: 30},
            radius: -100,
            shadow: 1.5,
            type: 'spot'
        })).toEqual({
            angle: 90,
            color: '#ff8040',
            intensity: 0,
            position: {x: 10, y: 0, z: 30},
            radius: 0,
            shadow: 1,
            type: 'spot'
        });
        expect(normalizeLight({shadow: -1, type: 'unknown'})).toEqual(expect.objectContaining({
            shadow: 0,
            type: 'point'
        }));
    });

    test('splits a fractional shadow into shadowed and unshadowed GPU lights', () => {
        const renderer = Object.create(ModelRenderer.prototype);
        renderer.scene = new THREE.Scene();
        renderer.renderer = {shadowMap: {enabled: false}};
        renderer.lightObjects = [];
        renderer.lightConfiguration = null;
        renderer.usesShadows = false;
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
        renderer.currentObjects = [mesh];

        const lights = [{
            color: '#ffffff',
            intensity: 4,
            position: {x: 0, y: 100, z: 200},
            radius: 1000,
            shadow: 0.25,
            type: 'point'
        }];
        renderer.setLights(lights);

        const pointLights = renderer.lightObjects.filter(object => object.isPointLight);
        expect(pointLights).toHaveLength(2);
        expect(pointLights.find(light => light.castShadow).intensity).toBe(1);
        expect(pointLights.find(light => !light.castShadow).intensity).toBe(3);
        expect(renderer.renderer.shadowMap.enabled).toBe(true);
        expect(mesh.castShadow).toBe(true);
        expect(mesh.receiveShadow).toBe(true);

        renderer.setLights([]);
        expect(renderer.renderer.shadowMap.enabled).toBe(false);
        expect(mesh.castShadow).toBe(false);
        expect(mesh.receiveShadow).toBe(false);
    });

    test('reuses a cloned model hierarchy while only its transform changes', () => {
        const renderer = Object.create(ModelRenderer.prototype);
        renderer.canvas = {height: 0, reusable: true, width: 0};
        renderer.renderer = {
            render: jest.fn(),
            setSize: jest.fn((width, height) => {
                renderer.canvas.width = width;
                renderer.canvas.height = height;
            })
        };
        renderer.scene = new THREE.Scene();
        renderer.camera = new THREE.PerspectiveCamera();
        renderer.currentObjects = [];
        renderer.currentSources = [];
        renderer.currentAnimationNames = [];
        renderer.animationStates = new WeakMap();

        const sourceObject = new THREE.Group();
        const clone = jest.spyOn(sourceObject, 'clone');
        const cameraTransform = {
            focalLength: DEFAULT_FOCAL_LENGTH,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        };
        const makeItem = worldX => ({
            animationName: '',
            frame: 1,
            sourceObject,
            transform: {
                rotation: {x: 0, y: 0, z: 0},
                rotationOrder: 'XYZ',
                scale: {x: 1, y: 1, z: 1},
                size: 100,
                worldX,
                worldY: 0,
                worldZ: 480
            }
        });

        renderer.renderWorldScene([makeItem(0)], cameraTransform, [480, 360], 2);
        const firstClone = renderer.currentObjects[0];
        renderer.renderWorldScene([makeItem(80)], cameraTransform, [480, 360], 2);

        expect(clone).toHaveBeenCalledTimes(1);
        expect(renderer.currentObjects[0]).toBe(firstClone);
        expect(renderer.currentObjects[0].position.x).toBe(80);
        expect(renderer.renderer.render).toHaveBeenCalledTimes(2);
    });

    test('submits a GPU render for every completed scene', () => {
        const renderer = Object.create(ModelRenderer.prototype);
        renderer.canvas = {height: 0, reusable: true, width: 0};
        renderer.renderer = {
            render: jest.fn(),
            setSize: jest.fn((width, height) => {
                renderer.canvas.width = width;
                renderer.canvas.height = height;
            })
        };
        renderer.scene = new THREE.Scene();
        renderer.camera = new THREE.PerspectiveCamera();
        renderer.currentObjects = [];
        renderer.currentSources = [];
        renderer.currentAnimationNames = [];
        renderer.currentFrames = [];
        renderer.animationStates = new WeakMap();
        const sourceObject = new THREE.Group();
        const cameraTransform = {
            focalLength: DEFAULT_FOCAL_LENGTH,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            rotationOrder: 'XYZ'
        };
        const sceneItem = {
            animationName: '',
            frame: 1,
            sourceObject,
            transform: {
                rotation: {x: 0, y: 0, z: 0},
                rotationOrder: 'XYZ',
                scale: {x: 1, y: 1, z: 1},
                size: 100,
                worldX: 0,
                worldY: 0,
                worldZ: 480
            }
        };

        renderer.renderWorldScene([sceneItem], cameraTransform, [480, 360], 2);
        renderer.renderWorldScene([sceneItem], cameraTransform, [480, 360], 2);

        expect(renderer.renderer.render).toHaveBeenCalledTimes(2);
    });

    test('tightens the zBuffer camera range around visible 3D geometry', () => {
        const renderer = Object.create(ModelRenderer.prototype);
        renderer.camera = new THREE.PerspectiveCamera();
        renderer.camera.position.set(0, 0, 0);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial());
        mesh.position.set(0, 0, -480);
        mesh.updateMatrixWorld(true);
        renderer.currentObjects = [mesh];

        renderer.updateCameraDepthRange();

        expect(renderer.camera.near).toBeGreaterThan(400);
        expect(renderer.camera.near).toBeLessThan(480);
        expect(renderer.camera.far).toBeGreaterThan(480);
        expect(renderer.camera.far).toBeLessThan(600);
    });

    test('keeps the near plane close when geometry surrounds the camera', () => {
        const renderer = Object.create(ModelRenderer.prototype);
        renderer.camera = new THREE.PerspectiveCamera();
        renderer.camera.position.set(0, 0, 0);
        const room = new THREE.Mesh(new THREE.BoxGeometry(200, 200, 200), new THREE.MeshBasicMaterial());
        renderer.currentObjects = [room];

        renderer.updateCameraDepthRange();

        expect(renderer.camera.near).toBeCloseTo(0.1);
        expect(renderer.camera.far).toBeGreaterThan(100);

        room.geometry.dispose();
        room.material.dispose();
    });

    test('renders the model directly to the public canvas after the depth pass', () => {
        const renderer = Object.create(ModelRenderer.prototype);
        renderer.renderTarget = {};
        renderer.renderer = {
            outputColorSpace: THREE.SRGBColorSpace,
            clear: jest.fn(),
            render: jest.fn(),
            setRenderTarget: jest.fn()
        };
        renderer.scene = {};
        renderer.camera = {};
        renderer.screenScene = {};
        renderer.screenCamera = {};
        renderer.screenQuad = {material: null};
        renderer.depthCopyMaterial = {};
        renderer.canvas = {};
        renderer.depthCanvas = {height: 4, width: 4};
        renderer.depthContext = {drawImage: jest.fn()};
        renderer.depthVersion = 0;

        renderer.renderSceneWithZBuffer();

        expect(renderer.renderer.render).toHaveBeenNthCalledWith(1, renderer.scene, renderer.camera);
        expect(renderer.renderer.render).toHaveBeenNthCalledWith(2, renderer.screenScene, renderer.screenCamera);
        expect(renderer.renderer.render).toHaveBeenNthCalledWith(3, renderer.scene, renderer.camera);
        expect(renderer.depthContext.drawImage).toHaveBeenCalledWith(renderer.canvas, 0, 0, 4, 4);
        expect(renderer.depthVersion).toBe(1);
        expect(renderer.renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    });

    test('does not render geometry assigned to fully transparent materials', () => {
        const root = new THREE.Group();
        const hiddenMaterial = new THREE.MeshBasicMaterial({opacity: 0, transparent: true});
        const visibleMaterial = new THREE.MeshBasicMaterial({opacity: 0, transparent: false});
        root.add(
            new THREE.Mesh(new THREE.BufferGeometry(), hiddenMaterial),
            new THREE.Mesh(new THREE.BufferGeometry(), visibleMaterial)
        );

        expect(disableFullyTransparentMaterials(root)).toBe(root);

        expect(hiddenMaterial.visible).toBe(false);
        expect(visibleMaterial.visible).toBe(true);
    });

    test('disables only invisible entries in a multi-material mesh', () => {
        const hiddenMaterial = new THREE.MeshBasicMaterial({opacity: 0, transparent: true});
        const visibleMaterial = new THREE.MeshBasicMaterial({opacity: 0.5, transparent: true});
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), [hiddenMaterial, visibleMaterial]);

        disableFullyTransparentMaterials(mesh);

        expect(hiddenMaterial.visible).toBe(false);
        expect(visibleMaterial.visible).toBe(true);
    });

    test('binds MMD bone tracks to the skinned mesh before GLB export', () => {
        const root = new THREE.Group();
        const mesh = new THREE.SkinnedMesh();
        const bone = new THREE.Bone();
        bone.name = 'センター';
        mesh.name = 'mesh_0';
        mesh.add(bone);
        mesh.bind(new THREE.Skeleton([bone]));
        root.add(mesh);
        const clip = new THREE.AnimationClip('motion', 1, [
            new THREE.VectorKeyframeTrack('.bones[センター].position', [0, 1], [0, 0, 0, 1, 0, 0])
        ]);

        bindAnimationToMesh(clip, mesh);

        expect(clip.tracks[0].name).toBe('mesh_0.bones[センター].position');
        const binding = THREE.PropertyBinding.parseTrackName(clip.tracks[0].name);
        const trackMesh = THREE.PropertyBinding.findNode(root, binding.nodeName);
        expect(trackMesh).toBe(mesh);
        expect(trackMesh.skeleton.getBoneByName(binding.objectIndex)).toBe(bone);
    });

    test('restores MMD root bones beneath the skinned mesh for IK matrix updates', () => {
        const root = new THREE.Group();
        const mesh = new THREE.SkinnedMesh();
        const bone = new THREE.Bone();
        bone.position.set(1, 2, 3);
        mesh.geometry.userData.MMD = {bones: []};
        mesh.bind(new THREE.Skeleton([bone]));
        root.add(mesh, bone);
        root.position.set(4, 5, 6);
        root.updateMatrixWorld(true);
        const worldPosition = bone.getWorldPosition(new THREE.Vector3());

        expect(restoreMMDBoneHierarchy(root)).toBe(mesh);

        expect(bone.parent).toBe(mesh);
        expect(bone.getWorldPosition(new THREE.Vector3()).distanceTo(worldPosition)).toBeCloseTo(0);
    });

    test('samples MMD interpolation at every rendered frame before GLB export', () => {
        const track = new THREE.VectorKeyframeTrack(
            '.bones[センター].position',
            [0, 2 / 30],
            [0, 0, 0, 1, 0, 0]
        );
        track.createInterpolant = () => ({
            evaluate: time => new Float32Array([time * time, 0, 0])
        });
        const clip = new THREE.AnimationClip('motion', 2 / 30, [track]);

        const sampled = resampleAnimationClip(clip);

        expect(sampled.duration).toBeCloseTo(2 / 30);
        expect(sampled.tracks[0].times[0]).toBeCloseTo(0);
        expect(sampled.tracks[0].times[1]).toBeCloseTo(1 / 30);
        expect(sampled.tracks[0].times[2]).toBeCloseTo(2 / 30);
        expect(sampled.tracks[0].values[3]).toBeCloseTo(1 / 900);
        expect(sampled.tracks[0].getInterpolation()).toBe(THREE.InterpolateLinear);
    });

    test('derives focal length from FOV using half of the stage long side', () => {
        expect(focalLengthFromFOV(60, 480, 360)).toBeCloseTo(240 / Math.tan(Math.PI / 6));
        expect(focalLengthFromFOV(60, 360, 640)).toBeCloseTo(320 / Math.tan(Math.PI / 6));
        expect(fovFromFocalLength(focalLengthFromFOV(72, 480, 360), 480, 360)).toBeCloseTo(72);
    });

    test('converts the Movie positive-z camera into Three.js negative-z view space', () => {
        const zeroRotation = movieRotationToThreeQuaternion({x: 0, y: 0, z: 0}, 'XYZ');
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(zeroRotation);
        expect(forward.toArray()).toEqual([0, 0, -1]);

        const yaw = movieRotationToThreeQuaternion({x: 0, y: 90, z: 0}, 'XYZ');
        const turnedForward = new THREE.Vector3(0, 0, -1).applyQuaternion(yaw);
        expect(turnedForward.x).toBeCloseTo(1);
        expect(turnedForward.y).toBeCloseTo(0);
        expect(turnedForward.z).toBeCloseTo(0);
    });

    test('uses focal length to derive the vertical FOV for a stage-sized render', () => {
        expect(verticalFOVFromFocalLength(480, 360)).toBeCloseTo(
            2 * Math.atan(180 / 480) * (180 / Math.PI)
        );
    });

    test('keeps camera position in world space when camera rotation changes', () => {
        const threeCamera = new THREE.PerspectiveCamera();
        threeCamera.position.copy(moviePositionToThree({x: 100, y: 0, z: 0}));
        threeCamera.quaternion.copy(movieRotationToThreeQuaternion({
            x: 0,
            y: -Math.atan2(100, 480) * (180 / Math.PI),
            z: 0
        }, 'XYZ'));
        threeCamera.updateMatrixWorld(true);

        const cameraSpaceTarget = moviePositionToThree({x: 0, y: 0, z: 480})
            .applyMatrix4(threeCamera.matrixWorldInverse);
        expect(threeCamera.position.x).toBeCloseTo(100);
        expect(threeCamera.position.y).toBeCloseTo(0);
        expect(threeCamera.position.z).toBeCloseTo(0);
        expect(cameraSpaceTarget.x).toBeCloseTo(0);
        expect(cameraSpaceTarget.z).toBeLessThan(0);
    });

    test('uses focalLength*x/z and focalLength*y/z for 2.5D sprites', () => {
        expect(projectPosition({x: 120, y: -60, z: 240}, camera)).toMatchObject({
            inFront: true,
            perspective: 2,
            x: 240,
            y: -120
        });
    });

    test('camera translation is applied before perspective', () => {
        const movedCamera = {
            ...camera,
            position: {x: 20, y: 10, z: 100}
        };
        expect(projectPosition({x: 70, y: 35, z: 300}, movedCamera)).toMatchObject({
            perspective: 2.4,
            x: 120,
            y: 60
        });
    });

    test('look at keeps a camera facing positive z at zero rotation', () => {
        const rotation = cameraLookAt(
            {x: 0, y: 0, z: 0},
            {x: 0, y: 0, z: 480},
            'XYZ'
        );
        expect(rotation.x).toBeCloseTo(0);
        expect(rotation.y).toBeCloseTo(0);
        expect(rotation.z).toBeCloseTo(0);
    });
});


describe('Objects image plane instancing', () => {
    test('submits 1000 matching planes as one instanced mesh and reuses its buffer', () => {
        const renderer = Object.create(ModelRenderer.prototype);
        renderer.scene = new THREE.Scene();
        const source = createImagePlane({width: 32, height: 32}, 16, 16);
        renderer.currentObjects = Array.from({length: 1000}, (_, index) => {
            const object = source.clone();
            object.position.set(index, index * 2, -480);
            renderer.scene.add(object);
            return object;
        });
        const submitted = [];
        renderer.renderSceneWithZBuffer = jest.fn(() => {
            const visible = renderer.scene.children.filter(object => object.visible);
            expect(visible).toHaveLength(1);
            expect(visible[0].isInstancedMesh).toBe(true);
            expect(visible[0].count).toBe(1000);
            const matrix = new THREE.Matrix4();
            visible[0].getMatrixAt(999, matrix);
            expect(matrix.elements.slice(12, 15)).toEqual([999, 1998, -480]);
            submitted.push(visible[0]);
        });
        renderer.renderInstancedImagePlanes();
        renderer.renderInstancedImagePlanes();
        expect(submitted[0]).toBe(submitted[1]);
        expect(renderer.currentObjects.every(object => object.visible)).toBe(true);
        expect(renderer.scene.children).toHaveLength(1000);
        submitted[0].dispose();
        source.geometry.dispose();
        source.material.map.dispose();
        source.material.dispose();
    });

    test('preserves mirrored planes and restores visibility after a failed render', () => {
        const renderer = Object.create(ModelRenderer.prototype);
        renderer.scene = new THREE.Scene();
        const source = createImagePlane({width: 32, height: 32}, 16, 16);
        renderer.currentObjects = [source.clone(), source.clone(), source.clone()];
        renderer.currentObjects[2].scale.x = -1;
        renderer.currentObjects.forEach(object => renderer.scene.add(object));
        renderer.renderSceneWithZBuffer = () => {
            expect(renderer.scene.children.filter(object => object.visible)).toHaveLength(2);
            expect(renderer.currentObjects[2].visible).toBe(true);
            throw new Error('render failed');
        };
        expect(() => renderer.renderInstancedImagePlanes()).toThrow('render failed');
        expect(renderer.currentObjects.every(object => object.visible)).toBe(true);
        expect(renderer.scene.children).toHaveLength(3);
        renderer.imagePlaneBatches[0].dispose();
        source.geometry.dispose();
        source.material.map.dispose();
        source.material.dispose();
    });
});
