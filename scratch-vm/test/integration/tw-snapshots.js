const {test} = require('tap');
const Snapshots = require('../snapshot/lib');

for (const testCase of Snapshots.tests) {
    // eslint-disable-next-line no-loop-func
    test(testCase.id, async t => {
        const expected = Snapshots.getExpectedSnapshot(testCase);
        const actual = await Snapshots.generateActualSnapshot(testCase);
        const result = Snapshots.compareSnapshots(expected, actual);
        if (result === 'VALID') {
            t.pass('matches');
        } else if (result === 'INPUT_MODIFIED') {
            t.fail('input project changed; run: node test/snapshot --update');
        } else if (result === 'MISSING_SNAPSHOT') {
            t.fail('snapshot is missing; run: node test/snapshot --update');
        } else {
            // This assertion will always fail, but tap will print out the snapshots
            // for easier comparison.
            t.equal(expected, actual, 'did not match; you may have to run: node test/snapshot --update');
        }
        t.end();
    });
}
