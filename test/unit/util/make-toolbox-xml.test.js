import makeToolboxXML from '../../../src/lib/make-toolbox-xml';

describe('Movie toolbox categories', () => {
    test('exposes secondary easing controls', () => {
        const toolbox = makeToolboxXML(false, false, 'target', []);

        expect(toolbox).toContain('<block type="operator_easing">');
        expect(toolbox).toContain('<value name="STRENGTH"><shadow type="math_number"><field name="NUM">1</field>');
    });

    test('offers procedural shape blocks directly below Draw in Objects', () => {
        const categories = [{id: 'objects', xml: '<category id="objects" />'}];
        const toolbox = makeToolboxXML(false, false, 'target', categories, 'costume1');

        expect(toolbox).toContain('<category name="Objects" id="objects"');
        expect(toolbox).not.toContain('<category name="Shape"');
        expect(toolbox).not.toContain('<category name="Arc"');
        expect(toolbox).not.toContain('<category name="Circular Segment"');
        expect(toolbox).not.toContain('<category name="Line"');
        expect(toolbox).toContain('<block type="objects_draw">');
        expect(toolbox).toContain('<block type="objects_shape">');
        expect(toolbox).toContain('<field name="SHAPE">polygon</field>');
        expect(toolbox).toContain('<value name="RATIO"><shadow type="math_number"><field name="NUM">0.5</field>');
        expect(toolbox).toContain('<value name="INNER"><shadow type="math_number"><field name="NUM">50</field>');
        expect(toolbox).toContain('<value name="COLOR"><shadow type="colour_picker"><field name="COLOUR">#ffffff</field>');
        expect(toolbox).toContain('<value name="OPACITY"><shadow type="math_number"><field name="NUM">100</field>');
        expect(toolbox).toContain('<value name="FRAME"><shadow type="math_number"><field name="NUM">1</field>');
        expect(toolbox).toContain('<value name="SPEED"><shadow type="math_number"><field name="NUM">1</field>');
        expect(toolbox).toContain('<value name="VOLUME"><shadow type="math_number"><field name="NUM">100</field>');
        expect(toolbox).not.toContain('<statement name="SUBSTACK">');
        expect(toolbox).toContain('<value name="TEXT"><shadow type="text">');
        expect(toolbox).not.toContain('type="objects_position"');
        expect(toolbox).not.toContain('type="objects_rotation"');
        expect(toolbox).not.toContain('type="objects_scale"');
        expect(toolbox).not.toContain('type="objects_size"');
        expect(toolbox).not.toContain('type="objects_dimensions"');
        expect(toolbox).toContain('<value name="PX">');
        expect(toolbox).toContain('<value name="RZ">');
        expect(toolbox).toContain('<value name="SZ">');
        expect(toolbox).toContain('<value name="HEIGHT">');
        expect(toolbox).toContain('<value name="T1"><shadow type="math_number"><field name="NUM">0</field>');
        expect(toolbox).toContain('<value name="T2"><shadow type="math_number"><field name="NUM">Infinity</field>');
        expect(toolbox).toContain('<block type="objects_arc">');
        expect(toolbox).toContain('<block type="objects_circularSegment">');
        expect(toolbox).toContain('<block type="objects_line">');
        expect(toolbox).toContain('<block type="objects_pass">');
        expect(toolbox).toContain('<value name="POINTS"><shadow type="text">');
        expect(toolbox).toContain('<value name="START"><shadow type="math_angle"><field name="NUM">0</field>');
        expect(toolbox).toContain('<field name="ASSET">costume1</field>');
        expect(toolbox).toContain('<block type="objects_grouping"/>');
        expect(toolbox).toContain('<block type="objects_scene"/>');
        expect(toolbox).toContain('<block type="looks_clearlight"/>');
        expect(toolbox).toContain('<block type="looks_addpointlight">');
        expect(toolbox).toContain('<block type="looks_addlight">');
        expect(toolbox.indexOf('type="looks_clearlight"')).toBeGreaterThan(toolbox.indexOf('id="objects"'));
        expect(toolbox.indexOf('type="looks_addlight"')).toBeLessThan(toolbox.indexOf('</category>'));
        expect(toolbox.indexOf('<block type="objects_grouping"/>'))
            .toBeLessThan(toolbox.indexOf('<block type="objects_scene"/>'));
        expect(toolbox.indexOf('id="objects"')).toBeLessThan(toolbox.indexOf('id="motion"'));
        expect(toolbox.indexOf('id="objects"')).toBeLessThan(toolbox.indexOf('id="sound"'));
        expect(toolbox.indexOf('<block type="objects_draw">'))
            .toBeLessThan(toolbox.indexOf('<block type="objects_shape">'));
        expect(toolbox.indexOf('<block type="objects_shape">'))
            .toBeLessThan(toolbox.indexOf('<block type="objects_arc">'));
        expect(toolbox.indexOf('<block type="objects_arc">'))
            .toBeLessThan(toolbox.indexOf('<block type="objects_circularSegment">'));
        expect(toolbox.indexOf('<block type="objects_circularSegment">'))
            .toBeLessThan(toolbox.indexOf('<block type="objects_line">'));
        expect(toolbox.indexOf('<block type="objects_line">'))
            .toBeLessThan(toolbox.indexOf('<block type="objects_grouping"/>'));
    });

    test('places My Blocks Shader next to My Blocks as a native category', () => {
        const categories = [{
            id: 'myblocksshader',
            xml: '<category id="myblocksshader" name="My Blocks Shader" />'
        }];
        const toolbox = makeToolboxXML(false, false, 'target', categories);

        expect(toolbox).toContain('id="myBlocksShader"');
        expect(toolbox).toContain('custom="MY_BLOCKS_SHADER"');
        expect(toolbox).toContain('id="myBlocksShader"\n        colour="#FF6680"');
        expect(toolbox).not.toContain('id="myblocksshader"');
        expect(toolbox.indexOf('id="myBlocks"')).toBeLessThan(toolbox.indexOf('id="myBlocksShader"'));
    });

    test('shows the default Pen category below My Blocks Shader', () => {
        const categories = [
            {id: 'custom', xml: '<category id="custom" />'},
            {id: 'penfx', xml: '<category id="penfx" />'},
            {id: 'pen', xml: '<category id="pen" />'}
        ];
        const toolbox = makeToolboxXML(false, false, 'target', categories);

        expect(toolbox).toContain('id="pen"');
        expect(toolbox.indexOf('id="myBlocksShader"')).toBeLessThan(toolbox.indexOf('id="pen"'));
        expect(toolbox.indexOf('id="sound"')).toBeLessThan(toolbox.indexOf('id="custom"'));
    });

    test('places Looks (Pen FX) with built-in categories instead of extension categories', () => {
        const categories = [
            {id: 'custom', xml: '<category id="custom" />'},
            {id: 'penfx', xml: '<category id="penfx" />'}
        ];
        const toolbox = makeToolboxXML(false, false, 'target', categories);

        expect(toolbox.indexOf('id="penfx"')).toBeLessThan(toolbox.indexOf('id="sound"'));
        expect(toolbox.indexOf('id="penfx"')).toBeLessThan(toolbox.indexOf('id="motion"'));
        expect(toolbox.indexOf('id="sound"')).toBeLessThan(toolbox.indexOf('id="custom"'));
    });

    test('hides Looks while keeping later built-in and extension categories', () => {
        const categories = [
            {id: 'looks', xml: '<category id="looks"><block type="looks_show" /></category>'},
            {id: 'custom', xml: '<category id="custom" />'}
        ];
        const toolbox = makeToolboxXML(false, false, 'target', categories);

        expect(toolbox).not.toContain('id="looks"');
        expect(toolbox).not.toContain('type="looks_');
        expect(toolbox).toContain('id="sound"');
        expect(toolbox).toContain('id="custom"');
    });

    test('renames Motion to Camera and only offers camera controls', () => {
        const toolbox = makeToolboxXML(false, false, 'target', []);

        expect(toolbox).toContain('<category name="Camera" id="motion"');
        expect(toolbox).toContain('type="motion_setcamerato"');
        expect(toolbox).toContain('type="motion_lookat"');
        expect(toolbox).not.toContain('type="motion_gotoxyz"');
        expect(toolbox).not.toContain('type="motion_gotoxyz_nocamera"');
    });

    test('moves object transforms out of Camera', () => {
        const toolbox = makeToolboxXML(false, false, 'target', []);

        expect(toolbox).not.toContain('type="motion_setscale"');
        expect(toolbox).not.toContain('type="motion_setrotation"');
        expect(toolbox).not.toContain('type="motion_setx"');
    });

    test('shows the curated sound and event blocks', () => {
        const toolbox = makeToolboxXML(false, false, 'target', [], '', '', 'Music');

        expect(toolbox).not.toContain('type="event_whenflagclicked"');
        expect(toolbox).toContain('<block type="event_initialize"/>');
        expect(toolbox).toContain('<block type="event_renderframe"/>');
        expect(toolbox).not.toContain('<block type="event_renderframe">');
        expect(toolbox).toContain('type="sound_playattime"');
        expect(toolbox).toContain('<field name="SOUND_MENU">Music</field>');
        expect(toolbox).toContain('<value name="T1">');
        expect(toolbox).toContain('<value name="T2">');
        expect(toolbox).toContain('<field name="NUM">Infinity</field>');
        expect(toolbox).toContain('<value name="SPEED">');
        expect(toolbox).toContain('<value name="VOLUME">');
        expect(toolbox).not.toContain('type="sound_play"');
        expect(toolbox).not.toContain('type="sound_playuntildone"');
        expect(toolbox).not.toContain('type="sound_playatframe"');
    });

    test('curates core categories around compositing while legacy opcodes remain loadable', () => {
        const toolbox = makeToolboxXML(false, false, 'target', []);

        // Camera.
        expect(toolbox).not.toContain('type="motion_gotoxy"');
        expect(toolbox).not.toContain('type="motion_movesteps"');
        expect(toolbox).toContain('type="motion_setcamerax"');
        expect(toolbox).toContain('type="motion_changecamerazby"');
        expect(toolbox).toContain('type="motion_changecamerarotationby"');
        // Looks opcodes remain loadable for project compatibility but are not offered in the toolbox.
        expect(toolbox).not.toContain('id="looks"');
        expect(toolbox).not.toContain('type="looks_say"');
        expect(toolbox).not.toContain('type="looks_thinkforsecs"');
        expect(toolbox).not.toContain('type="looks_gotofrontback"');
        expect(toolbox).not.toContain('type="looks_goforwardbackwardlayers"');
        expect(toolbox).not.toContain('type="looks_nextcostume"');
        expect(toolbox).not.toContain('type="looks_changesizeby"');
        expect(toolbox).not.toContain('type="looks_turbulentdisplace"');
        expect(toolbox).not.toContain('type="looks_bloom"');
        expect(toolbox).not.toContain('type="looks_effectweight"');
        expect(toolbox).not.toContain('type="looks_hideallsprites"');
        // Sound.
        expect(toolbox).toContain('type="sound_playattime"');
        expect(toolbox).not.toContain('type="sound_play"');
        expect(toolbox).not.toContain('type="sound_playuntildone"');
        expect(toolbox).not.toContain('type="sound_playatframe"');
        expect(toolbox).not.toContain('type="sound_stopallsounds"');
        expect(toolbox).not.toContain('type="sound_seteffectto"');
        expect(toolbox).not.toContain('type="sound_changeeffectby"');
        expect(toolbox).not.toContain('type="sound_cleareffects"');
        expect(toolbox).not.toContain('type="sound_setvolumeto"');
        expect(toolbox).not.toContain('type="sound_changevolumeby"');
        expect(toolbox).not.toContain('type="sound_volume"');
        // Events.
        expect(toolbox).not.toContain('type="event_whenkeypressed"');
        expect(toolbox).not.toContain('type="event_whenthisspriteclicked"');
        expect(toolbox).not.toContain('type="event_whentouchingobject"');
        expect(toolbox).not.toContain('type="event_whenbackdropswitchesto"');
        expect(toolbox).not.toContain('type="event_whengreaterthan"');
        expect(toolbox).toContain('type="event_whenbroadcastreceived"');
        // Control.
        expect(toolbox).toContain('type="control_wait"');
        expect(toolbox).toContain('type="control_for_each"');
        expect(toolbox).not.toContain('type="control_all_at_once"');
        expect(toolbox).not.toContain('type="control_get_counter"');
        expect(toolbox).not.toContain('type="control_incr_counter"');
        expect(toolbox).not.toContain('type="control_clear_counter"');
        expect(toolbox).not.toContain('type="control_start_as_clone"');
        expect(toolbox).not.toContain('type="control_create_clone_of"');
        expect(toolbox).not.toContain('type="control_delete_this_clone"');
        // Sensing exposes the timer and its offset control.
        expect(toolbox).toContain('type="sensing_timer"');
        expect(toolbox).toContain('type="sensing_settimeroffsetto"');
        expect(toolbox).not.toContain('type="sensing_resettimer"');
        expect(toolbox).not.toContain('type="sensing_touchingobject"');
        expect(toolbox).not.toContain('type="sensing_answer"');
        // The legacy switch-model alias shares the render-model block definition and stays deduplicated.
        expect(toolbox).not.toContain('type="looks_switchmodelto"');
    });
});
