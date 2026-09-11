import VM from 'scratch-vm';
import compatBlocks from '../../../scratch-vm/src/compiler/compat-blocks';
import installMovieAssetManager from '../../../scratch-vm/src/lib/movie-asset-manager';

describe('Movie asset manager VM installation', () => {
    test('registers time-based sound blocks with the compiler compatibility layer', () => {
        const vm = new VM();

        installMovieAssetManager(vm);

        expect(vm.runtime._primitives.sound_playattime).toEqual(expect.any(Function));
        expect(compatBlocks.stacked).toContain('sound_playattime');
    });

    test('runs the migrated VM feature lifecycle through the VM method', () => {
        const vm = new VM();
        vm.runtime.renderer = {_gl: {}};

        expect(() => vm.installShadingFeatures()).not.toThrow();
        expect(vm.extensionManager.isExtensionLoaded('pen')).toBe(true);
        expect(vm.runtime._primitives.sound_playattime).toEqual(expect.any(Function));
        expect(compatBlocks.stacked).toContain('sound_playattime');
    });
});
