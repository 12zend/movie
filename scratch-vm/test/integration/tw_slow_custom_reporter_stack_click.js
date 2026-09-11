const {test} = require('tap');
const fs = require('fs');
const path = require('path');
const VirtualMachine = require('../../src/virtual-machine');

const fixtureData = fs.readFileSync(path.join(__dirname, '../fixtures/tw-slow-custom-reporter-stack-click.sb3'));

// After starting this block, first step will yield, second step will report value
const procedureCallBlockId = 'e';

test('when thread target is editing target', t => {
    const vm = new VirtualMachine();
    vm.loadProject(fixtureData).then(() => {
        const visualReports = [];
        vm.on('VISUAL_REPORT', visualReport => {
            visualReports.push(visualReport);
        });

        vm.setEditingTarget(vm.runtime.getSpriteTargetByName('Sprite1').id);
        vm.runtime.toggleScript(procedureCallBlockId, {
            stackClick: true
        });

        t.same(visualReports, []);

        vm.runtime._step();
        t.same(visualReports, []);

        vm.runtime._step();
        t.same(visualReports, [
            {
                id: 'e',
                value: 'return value'
            }
        ]);

        t.end();
    });
});

test('when thread target is not editing target', t => {
    const vm = new VirtualMachine();
    vm.loadProject(fixtureData).then(() => {
        const visualReports = [];
        vm.on('VISUAL_REPORT', visualReport => {
            visualReports.push(visualReport);
        });

        vm.setEditingTarget(vm.runtime.getSpriteTargetByName('Sprite1').id);
        vm.runtime.toggleScript(procedureCallBlockId, {
            stackClick: true
        });

        t.same(visualReports, []);

        vm.runtime._step();
        t.same(visualReports, []);

        vm.setEditingTarget(vm.runtime.getSpriteTargetByName('Sprite2').id);

        vm.runtime._step();
        t.same(visualReports, []);

        t.end();
    });
});
