import installShadingFeaturesFromVm from '../../scratch-vm/src/lib/movie-features';

/**
 * Install Movie/Shading features on both the migrated VM and older VM
 * instances that may still be supplied by an embedding application.
 *
 * The method on the VM is the preferred path because it keeps the VM-owned
 * installation API together with the VM implementation. The fallback keeps
 * GUI startup compatible with an already-created VM whose prototype predates
 * that method.
 *
 * @param {object} vm VM instance to extend
 * @returns {object} the extended VM instance
 */
const installShadingFeatures = vm => {
    if (vm && typeof vm.installShadingFeatures === 'function') {
        return vm.installShadingFeatures();
    }
    return installShadingFeaturesFromVm(vm);
};

export default installShadingFeatures;
