const DEFAULT_EXTENSION_IDS = [
    'pen'
];

/**
 * Load extensions that are part of Movie's standard editor rather than
 * optional add-ons. Projects still serialize Pen blocks using Scratch's
 * existing extension format, so this does not change project compatibility.
 *
 * @param {VirtualMachine} vm Scratch VM instance.
 * @returns {VirtualMachine} The same VM instance.
 */
const installDefaultExtensions = vm => {
    for (const extensionId of DEFAULT_EXTENSION_IDS) {
        if (!vm.extensionManager.isExtensionLoaded(extensionId)) {
            vm.extensionManager.loadExtensionIdSync(extensionId);
        }
    }
    return vm;
};

export {
    DEFAULT_EXTENSION_IDS,
    installDefaultExtensions as default
};
