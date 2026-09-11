const {test} = require('tap');
const fs = require('fs');
const path = require('path');
const VM = require('../../src/virtual-machine');

test('spork compat: procedure prototype and argument reporters load as shadows', t => {
    const vm = new VM();
    const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/tw-spork-custom-block-definition.sb3'));
    vm.loadProject(fixture).then(() => {
        let prototypeCount = 0;
        let argumentReporterCount = 0;

        for (const target of vm.runtime.targets) {
            for (const block of Object.values(target.blocks._blocks)) {
                if (block.opcode === 'procedures_prototype') {
                    prototypeCount++;
                    t.equal(block.shadow, true);
                } else if (block.opcode.startsWith('argument_reporter_')) {
                    argumentReporterCount++;
                    t.equal(block.shadow, true);
                }
            }
        }

        t.equal(prototypeCount, 1);
        t.equal(argumentReporterCount, 2);

        t.end();
    });
});

test('spork compat: control_stop blocks get a mutation derived from STOP_OPTION', t => {
    const vm = new VM();
    const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/tw-spork-stop-other-scripts.sb3'));
    vm.loadProject(fixture).then(() => {
        let otherScriptsInSprite = 0;
        let all = 0;
        let thisScript = 0;

        for (const target of vm.runtime.targets) {
            for (const block of Object.values(target.blocks._blocks)) {
                if (block.opcode !== 'control_stop') {
                    continue;
                }
                const stopOption = block.fields.STOP_OPTION.value;
                if (stopOption === 'other scripts in sprite') {
                    otherScriptsInSprite++;
                    t.same(block.mutation, {tagName: 'mutation', hasnext: 'true', children: []});
                } else if (stopOption === 'all') {
                    all++;
                    t.same(block.mutation, {tagName: 'mutation', hasnext: 'false', children: []});
                } else if (stopOption === 'this script') {
                    thisScript++;
                    t.same(block.mutation, {tagName: 'mutation', hasnext: 'false', children: []});
                } else {
                    t.fail(`unexpected STOP_OPTION value: ${stopOption}`);
                }
            }
        }

        t.equal(otherScriptsInSprite, 2);
        t.equal(all, 1);
        t.equal(thisScript, 1);

        t.end();
    });
});
