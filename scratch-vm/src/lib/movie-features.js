import installGraphicEffectsManager from './graphic-effects-manager';
import installMovieEasing from './movie-easing';
import installTimerOffset from './timer-offset';
import installListBlocks from './list-blocks';
import installDefaultExtensions from './default-extensions';
import installMovieAssetManager from './movie-asset-manager';
import installPenFX from './pen-fx';
import installObjectBlocks from './object-blocks';

const resetCompilerCaches = vm => {
    const runtime = vm && vm.runtime;
    if (!runtime) return;

    const containers = [];
    if (runtime.flyoutBlocks) containers.push(runtime.flyoutBlocks);
    for (const target of runtime.targets || []) {
        if (target && target.blocks) containers.push(target.blocks);
    }
    for (const container of containers) {
        if (typeof container.resetCache === 'function') container.resetCache();
    }
};

/**
 * Install Shading's runtime features on a VM.
 *
 * The GUI only needs to trigger this lifecycle hook after it has attached a renderer. All
 * primitives, extensions, serialization hooks, and rendering state then live in the VM package.
 * Keeping the order here preserves the original initialization contract: the Movie asset
 * manager exists before Pen FX and Objects attach their frame transactions.
 *
 * @param {VirtualMachine} vm The VM to extend.
 * @returns {VirtualMachine} The same VM instance.
 */
const installShadingFeatures = vm => {
    if (vm && vm.__shadingFeaturesInstalled) {
        resetCompilerCaches(vm);
        return vm;
    }
    installGraphicEffectsManager(vm);
    installMovieEasing(vm);
    installTimerOffset(vm);
    installListBlocks(vm);
    installDefaultExtensions(vm);
    installMovieAssetManager(vm);
    installPenFX(vm);
    installObjectBlocks(vm);
    vm.__shadingFeaturesInstalled = true;
    resetCompilerCaches(vm);
    return vm;
};

export {installShadingFeatures};
export default installShadingFeatures;
