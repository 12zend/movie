const {test} = require('tap');
const VM = require('../../src/virtual-machine');

test('saveProjectSb3 is deterministic over time', t => {
    const vm = new VM();
    Promise.all([
        vm.saveProjectSb3('nodebuffer'),
        // Zip modification time is only accurate to the second
        new Promise(resolve => setTimeout(resolve, 1000)).then(() => vm.saveProjectSb3('nodebuffer'))
    ]).then(([a, b]) => {
        t.same(a, b);
        t.end();
    });
});
