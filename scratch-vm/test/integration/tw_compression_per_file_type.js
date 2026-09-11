const {test} = require('tap');
const fs = require('fs');
const path = require('path');
const VM = require('../../src/virtual-machine');
const makeTestStorage = require('../fixtures/make-test-storage');
const JSZip = require('@turbowarp/jszip');

test('saveProjectSb3() per-file compression', t => {
    const vm = new VM();
    vm.attachStorage(makeTestStorage());
    const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/tw-mixed-file-formats.sb3'));
    vm.loadProject(fixture)
        .then(() => vm.saveProjectSb3('arraybuffer'))
        .then(buffer => JSZip.loadAsync(buffer))
        .then(zip => {
            const isCompressed = pathInZip => {
                // note: uses JSZip private APIs, not very stable, but it should be okay...
                const file = zip.files[pathInZip];
                return file._data.compression.magic === '\x08\x00';
            };

            t.ok(isCompressed('project.json'));
            t.ok(isCompressed('5cb46ddd903fc2c9976ff881df9273c9.wav'));
            t.ok(isCompressed('cd21514d0531fdffb22204e0ec5ed84a.svg'));

            t.notOk(isCompressed('0b2e50ca4107ce57416e2ceb840a6347.jpg'));
            t.notOk(isCompressed('5c8826d846c06dddeb77590e8792fb7d.png'));

            t.end();
        });
});
