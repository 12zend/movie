const {test} = require('tap');
const Runtime = require('../../src/engine/runtime');

test('isDown does not error before project loads', t => {
    const rt = new Runtime();
    rt.ioDevices.mouse.postData({
        isDown: true,
        x: 20,
        y: 20,
        canvasWidth: 100,
        canvasHeight: 100
    });
    t.end();
});
