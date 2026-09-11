// Public Movie 3D runtime API.
//
// Keep this module as a compatibility facade: Movie asset-manager modules and the GUI import from
// `./model-runtime`, while the implementation is organized by responsibility in the sibling modules.
export {
    DEFAULT_DEPTH,
    DEFAULT_FOCAL_LENGTH,
    DEFAULT_FOV,
    DEFAULT_STAGE_HEIGHT,
    DEFAULT_STAGE_WIDTH,
    ROTATION_ORDERS,
    STUDIO_LIGHTING,
    cameraLookAt,
    createBuildingPrimitive,
    createImagePlane,
    disposeObject,
    focalLengthFromFOV,
    fovFromFocalLength,
    loadBuildingTexture,
    makeBuildingMaterial,
    moviePositionToThree,
    movieRotationToThreeQuaternion,
    normalizeFOV,
    normalizeLight,
    projectPosition,
    spritePlaneMatrix,
    verticalFOVFromFocalLength
} from './model-runtime-geometry';

export {
    attachMotionToGLB,
    bindAnimationToMesh,
    convertModelToGLB,
    disableFullyTransparentMaterials,
    loadGLBObject,
    restoreMMDBoneHierarchy,
    resampleAnimationClip
} from './model-runtime-models';

export {ModelRenderer} from './model-runtime-renderer';
