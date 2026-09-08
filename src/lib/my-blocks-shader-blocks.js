import {
    SHADER_CALL_OPCODE,
    SHADER_GET_OPCODES,
    SHADER_MARKER,
    SHADER_RETURN_FROM_OPCODE,
    SHADER_RETURN_OPCODE
} from './my-blocks-shader';

const CATEGORY_CALLBACK = 'MY_BLOCKS_SHADER';
const CREATE_CALLBACK = 'CREATE_MY_BLOCKS_SHADER';
// Match Scratch's My Blocks palette so definitions, calls, arguments and
// shader-only blocks read as one block family.
const PRIMARY = '#FF6680';
const SECONDARY = '#FF4D6A';
const TERTIARY = '#FF3355';
const SHADER_ATTRIBUTES = [
    SHADER_MARKER,
    'shaderid',
    'shaderuserproccode',
    'shaderuserargumentids',
    'shaderuserargumentnames',
    'shaderuserargumentdefaults',
    'shadercoordids'
];
const SHADER_CALL_ATTRIBUTES = [SHADER_MARKER, 'shaderid', 'shaderproccode'];

const lockShaderColour = block => {
    if (!block || typeof block.setColour !== 'function') return;
    if (!block.myBlocksShaderSetColour_) {
        block.myBlocksShaderSetColour_ = block.setColour.bind(block);
        block.setColour = () => block.myBlocksShaderSetColour_(PRIMARY, SECONDARY, TERTIARY);
    }
    block.setColour();
};

const parseJSON = (value, fallback = []) => {
    try {
        const result = JSON.parse(value);
        return Array.isArray(result) ? result : fallback;
    } catch (error) {
        return fallback;
    }
};

const uid = ScratchBlocks => {
    if (ScratchBlocks.utils && typeof ScratchBlocks.utils.genUid === 'function') {
        return ScratchBlocks.utils.genUid();
    }
    return `shader_${Date.now()}_${Math.random().toString(36)
        .slice(2)}`;
};

const prepareShaderMutation = (ScratchBlocks, editorMutation) => {
    const mutation = editorMutation.cloneNode(true);
    const userProcCode = mutation.getAttribute('proccode') || ScratchBlocks.Msg.PROCEDURE_DEFAULT_NAME || 'shader';
    const userIds = parseJSON(mutation.getAttribute('argumentids'));
    const userNames = parseJSON(mutation.getAttribute('argumentnames'));
    const userDefaults = parseJSON(mutation.getAttribute('argumentdefaults'));
    const storedCoordinates = parseJSON(mutation.getAttribute('shadercoordids'));
    const coordinateIds = storedCoordinates.length === 2 ? storedCoordinates : [uid(ScratchBlocks), uid(ScratchBlocks)];

    mutation.setAttribute(SHADER_MARKER, 'true');
    mutation.setAttribute('shaderid', mutation.getAttribute('shaderid') || uid(ScratchBlocks));
    mutation.setAttribute('shaderuserproccode', userProcCode);
    mutation.setAttribute('shaderuserargumentids', JSON.stringify(userIds));
    mutation.setAttribute('shaderuserargumentnames', JSON.stringify(userNames));
    mutation.setAttribute('shaderuserargumentdefaults', JSON.stringify(userDefaults));
    mutation.setAttribute('shadercoordids', JSON.stringify(coordinateIds));
    mutation.setAttribute('proccode', `${userProcCode.trim()} %s %s`);
    mutation.setAttribute('argumentids', JSON.stringify(userIds.concat(coordinateIds)));
    mutation.setAttribute('argumentnames', JSON.stringify(userNames.concat(['cx', 'cy'])));
    mutation.setAttribute('argumentdefaults', JSON.stringify(userDefaults.concat(['0', '0'])));
    mutation.setAttribute('warp', 'true');
    return mutation;
};

const stripShaderCoordinates = mutation => {
    const editorMutation = mutation.cloneNode(true);
    const userProcCode = mutation.getAttribute('shaderuserproccode');
    const userIds = mutation.getAttribute('shaderuserargumentids');
    const userNames = mutation.getAttribute('shaderuserargumentnames');
    const userDefaults = mutation.getAttribute('shaderuserargumentdefaults');
    if (userProcCode !== null) editorMutation.setAttribute('proccode', userProcCode);
    if (userIds !== null) editorMutation.setAttribute('argumentids', userIds);
    if (userNames !== null) editorMutation.setAttribute('argumentnames', userNames);
    if (userDefaults !== null) editorMutation.setAttribute('argumentdefaults', userDefaults);
    return editorMutation;
};

const callMutationFromDefinition = definitionMutation => {
    const mutation = document.createElement('mutation');
    mutation.setAttribute('generateshadows', 'true');
    mutation.setAttribute('warp', 'true');
    mutation.setAttribute('proccode', definitionMutation.getAttribute('shaderuserproccode') || 'shader');
    mutation.setAttribute('argumentids', definitionMutation.getAttribute('shaderuserargumentids') || '[]');
    mutation.setAttribute('argumentnames', definitionMutation.getAttribute('shaderuserargumentnames') || '[]');
    mutation.setAttribute('argumentdefaults', definitionMutation.getAttribute('shaderuserargumentdefaults') || '[]');
    mutation.setAttribute(SHADER_MARKER, 'true');
    mutation.setAttribute('shaderid', definitionMutation.getAttribute('shaderid'));
    mutation.setAttribute('shaderproccode', definitionMutation.getAttribute('proccode'));
    return mutation;
};

const patchProcedureMutations = ScratchBlocks => {
    const patchProcedureDefinition = procedureDefinition => {
        if (!procedureDefinition || procedureDefinition.myBlocksShaderPatched_) return;
        procedureDefinition.myBlocksShaderPatched_ = true;
        const originalToDom = procedureDefinition.mutationToDom;
        const originalFromDom = procedureDefinition.domToMutation;
        procedureDefinition.mutationToDom = function (...args) {
            const mutation = originalToDom.apply(this, args);
            if (this.myBlocksShaderAttributes_) {
                for (const name of SHADER_ATTRIBUTES) {
                    if (this.myBlocksShaderAttributes_[name] !== null) {
                        mutation.setAttribute(name, this.myBlocksShaderAttributes_[name]);
                    }
                }
            }
            return mutation;
        };
        procedureDefinition.domToMutation = function (mutation) {
            originalFromDom.call(this, mutation);
            if (mutation.getAttribute(SHADER_MARKER) === 'true') {
                this.myBlocksShaderAttributes_ = {};
                for (const name of SHADER_ATTRIBUTES) {
                    this.myBlocksShaderAttributes_[name] = mutation.getAttribute(name);
                }
                lockShaderColour(this);
            }
        };
    };

    patchProcedureDefinition(ScratchBlocks.Blocks.procedures_prototype);
    patchProcedureDefinition(ScratchBlocks.Blocks.procedures_declaration);

    const caller = ScratchBlocks.Blocks.procedures_call;
    if (caller && caller.myBlocksShaderPatchVersion_ !== 4) {
        caller.myBlocksShaderPatched_ = true;
        caller.myBlocksShaderPatchVersion_ = 4;
        const originalToDom = caller.mutationToDom;
        const originalFromDom = caller.domToMutation;
        const originalUpdateDisplay = caller.updateDisplay_;
        const originalOnChange = caller.onchange;
        caller.mutationToDom = function (...args) {
            const mutation = originalToDom.apply(this, args);
            if (this.myBlocksShaderAttributes_) {
                for (const name of SHADER_CALL_ATTRIBUTES) {
                    const value = this.myBlocksShaderAttributes_[name];
                    if (value !== null) mutation.setAttribute(name, value);
                }
            }
            return mutation;
        };
        caller.domToMutation = function (mutation) {
            originalFromDom.call(this, mutation);
            if (mutation.getAttribute(SHADER_MARKER) === 'true') {
                this.myBlocksShaderAttributes_ = {};
                for (const name of SHADER_CALL_ATTRIBUTES) {
                    this.myBlocksShaderAttributes_[name] = mutation.getAttribute(name);
                }
                lockShaderColour(this);
            }
        };
        caller.updateDisplay_ = function (...args) {
            const result = originalUpdateDisplay.apply(this, args);
            if (this.myBlocksShaderAttributes_) lockShaderColour(this);
            return result;
        };
        caller.onchange = function (...args) {
            let result;
            if (originalOnChange) result = originalOnChange.apply(this, args);
            if (this.myBlocksShaderAttributes_) lockShaderColour(this);
            return result;
        };
    }

    if (!ScratchBlocks.Procedures.myBlocksShaderFlyoutPatched_) {
        ScratchBlocks.Procedures.myBlocksShaderFlyoutPatched_ = true;
        const originalFlyout = ScratchBlocks.Procedures.flyoutCategory;
        ScratchBlocks.Procedures.flyoutCategory = workspace => originalFlyout(workspace).filter(node => {
            if (!node || String(node.tagName).toLowerCase() !== 'block') return true;
            const mutation = Array.from(node.childNodes || []).find(child =>
                child && String(child.tagName).toLowerCase() === 'mutation');
            return !mutation || mutation.getAttribute(SHADER_MARKER) !== 'true';
        });
    }

    if (!ScratchBlocks.Procedures.myBlocksShaderEditorPatched_) {
        ScratchBlocks.Procedures.myBlocksShaderEditorPatched_ = true;
        const originalEdit = ScratchBlocks.Procedures.editProcedureCallback_;
        ScratchBlocks.Procedures.editProcedureCallback_ = block => {
            if (block && block.type === SHADER_CALL_OPCODE && block.myBlocksShaderAttributes_) {
                const workspace = block.workspace.isFlyout ? block.workspace.targetWorkspace : block.workspace;
                const attributes = block.myBlocksShaderAttributes_;
                const id = attributes.shaderid;
                const familyPrototype = workspace.getAllBlocks().find(candidate => {
                    if (candidate.type !== 'procedures_prototype') return false;
                    const candidateAttributes = candidate.myBlocksShaderAttributes_;
                    return Boolean(candidateAttributes && candidateAttributes.shaderid === id);
                });
                if (familyPrototype) return originalEdit(familyPrototype);
            }
            return originalEdit(block);
        };
    }
};

const defineShaderBlocks = ScratchBlocks => {
    patchProcedureMutations(ScratchBlocks);

    if (!ScratchBlocks.Blocks[SHADER_RETURN_FROM_OPCODE]) {
        ScratchBlocks.Blocks[SHADER_RETURN_FROM_OPCODE] = {
            init: function () {
                this.jsonInit({
                    message0: 'return RGB from x: %1 y: %2',
                    args0: [
                        {type: 'input_value', name: 'X', check: ['Number', 'String']},
                        {type: 'input_value', name: 'Y', check: ['Number', 'String']}
                    ],
                    inputsInline: true,
                    colour: PRIMARY,
                    colourSecondary: SECONDARY,
                    colourTertiary: TERTIARY,
                    extensions: ['shape_end']
                });
                lockShaderColour(this);
            }
        };
    }

    if (ScratchBlocks.Blocks[SHADER_RETURN_OPCODE]) return;

    ScratchBlocks.Blocks[SHADER_RETURN_OPCODE] = {
        init: function () {
            this.jsonInit({
                message0: 'return RGB r: %1 g: %2 b: %3',
                args0: [
                    {type: 'input_value', name: 'R', check: ['Number', 'String']},
                    {type: 'input_value', name: 'G', check: ['Number', 'String']},
                    {type: 'input_value', name: 'B', check: ['Number', 'String']}
                ],
                inputsInline: true,
                colour: PRIMARY,
                colourSecondary: SECONDARY,
                colourTertiary: TERTIARY,
                extensions: ['shape_end']
            });
            lockShaderColour(this);
        }
    };

    for (const opcode of Object.keys(SHADER_GET_OPCODES)) {
        const channel = SHADER_GET_OPCODES[opcode];
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit({
                    message0: `get ${channel} x: %1 y: %2`,
                    args0: [
                        {type: 'input_value', name: 'X', check: ['Number', 'String']},
                        {type: 'input_value', name: 'Y', check: ['Number', 'String']}
                    ],
                    inputsInline: true,
                    output: 'Number',
                    outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
                    colour: PRIMARY,
                    colourSecondary: SECONDARY,
                    colourTertiary: TERTIARY
                });
                lockShaderColour(this);
            }
        };
    }

};

const starterDefinitionXML = (ScratchBlocks, mutation) => {
    const mutationText = ScratchBlocks.Xml.domToText(mutation);
    const numberShadow = '<shadow type="math_number"><field name="NUM">0</field></shadow>';
    const coordinateReporter = name => (
        `<block type="argument_reporter_string_number"><field name="VALUE">${name}</field></block>`
    );
    const sample = channel => (
        `<block type="myblocksshader_get_${channel}">` +
        `<value name="X">${numberShadow}${coordinateReporter('cx')}</value>` +
        `<value name="Y">${numberShadow}${coordinateReporter('cy')}</value>` +
        '</block>'
    );
    return `<xml><block type="procedures_definition">` +
        `<statement name="custom_block"><shadow type="procedures_prototype">${mutationText}</shadow></statement>` +
        `<next><block type="${SHADER_RETURN_OPCODE}">` +
        `<value name="R">${numberShadow}${sample('r')}</value>` +
        `<value name="G">${numberShadow}${sample('g')}</value>` +
        `<value name="B">${numberShadow}${sample('b')}</value>` +
        `</block></next></block></xml>`;
};

const createDefinitionCallback = (ScratchBlocks, workspace) => mutation => {
    if (!mutation) return;
    const xml = ScratchBlocks.Xml.textToDom(starterDefinitionXML(ScratchBlocks, mutation)).firstChild;
    ScratchBlocks.Events.setGroup(true);
    try {
        const block = ScratchBlocks.Xml.domToBlock(xml, workspace);
        lockShaderColour(block);
        try {
            const scale = workspace.scale;
            let x = -workspace.scrollX;
            x += workspace.RTL ? workspace.getMetrics().contentWidth - 30 : 30;
            const visibleTop = (-workspace.scrollY + 30) / scale;
            const occupiedBottom = workspace.getTopBlocks(false).reduce((bottom, candidate) => {
                if (candidate === block || candidate.type !== 'procedures_definition') return bottom;
                const position = candidate.getRelativeToSurfaceXY();
                // A shader definition consists of its hat plus the starter return
                // stack. Reserve enough vertical space even on ScratchBlocks builds
                // where getHeightWidth() excludes the connected next block.
                return Math.max(bottom, position.y + 140);
            }, visibleTop);
            block.moveBy(x / scale, Math.max(visibleTop, occupiedBottom));
            block.scheduleSnapAndBump();
        } catch (error) {
            // The definition already exists. Placement must never prevent the
            // modal's OK action from completing.
            // eslint-disable-next-line no-console
            console.warn('[My Blocks Shader] Could not position the new definition.', error);
        }
    } catch (error) {
        // A malformed connection must not leave the procedure modal stuck open.
        // eslint-disable-next-line no-console
        console.error('[My Blocks Shader] Could not create the shader definition.', error);
    } finally {
        ScratchBlocks.Events.setGroup(false);
    }
};

const recolorMyBlocksShaderDefinitions = workspace => {
    if (!workspace) return;
    for (const block of workspace.getAllBlocks()) {
        if (block.type !== 'procedures_definition') continue;
        const input = block.getInput('custom_block');
        const prototype = input && input.connection && input.connection.targetBlock();
        if (prototype && prototype.myBlocksShaderAttributes_) {
            lockShaderColour(block);
            lockShaderColour(prototype);
        }
    }
    for (const block of workspace.getAllBlocks()) {
        if (block.type === SHADER_CALL_OPCODE && block.myBlocksShaderAttributes_) {
            lockShaderColour(block);
        }
    }
};

const xmlNodes = (ScratchBlocks, xml) => {
    const root = ScratchBlocks.Xml.textToDom(`<xml>${xml}</xml>`);
    return Array.from(root.childNodes).filter(node => node.nodeType === 1);
};

const shaderFlyout = (ScratchBlocks, workspace) => {
    // This also upgrades colours of already-placed calls after a theme or hot
    // reload as soon as the category is opened.
    recolorMyBlocksShaderDefinitions(workspace);
    workspace.registerButtonCallback(CREATE_CALLBACK, () => {
        const mutation = ScratchBlocks.Procedures.newProcedureMutation();
        mutation.setAttribute(SHADER_MARKER, 'true');
        mutation.setAttribute('shaderid', uid(ScratchBlocks));
        ScratchBlocks.Procedures.externalProcedureDefCallback(
            mutation,
            createDefinitionCallback(ScratchBlocks, workspace)
        );
    });

    const definitions = workspace.getAllBlocks()
        .filter(block => block.type === 'procedures_prototype' && block.myBlocksShaderAttributes_)
        .map(block => block.mutationToDom(true))
        .sort((a, b) => String(a.getAttribute('shaderuserproccode')).localeCompare(
            String(b.getAttribute('shaderuserproccode'))));
    const callXML = definitions.map(mutation => (
        `<block type="${SHADER_CALL_OPCODE}" gap="12">` +
        `${ScratchBlocks.Xml.domToText(callMutationFromDefinition(mutation))}</block>`
    )).join('');
    const numberShadow = '<shadow type="math_number"><field name="NUM">0</field></shadow>';
    const getBlock = channel => `<block type="myblocksshader_get_${channel}">` +
        `<value name="X">${numberShadow}</value><value name="Y">${numberShadow}</value></block>`;
    const returnBlock = `<block type="${SHADER_RETURN_OPCODE}">` +
        `<value name="R">${numberShadow}</value><value name="G">${numberShadow}</value>` +
        `<value name="B">${numberShadow}</value></block>`;
    const returnFromBlock = `<block type="${SHADER_RETURN_FROM_OPCODE}">` +
        `<value name="X">${numberShadow}</value><value name="Y">${numberShadow}</value></block>`;
    const result = xmlNodes(ScratchBlocks,
        `<button text="Make a Block" callbackKey="${CREATE_CALLBACK}"></button>${callXML}` +
        `${callXML ? '<sep gap="36"></sep>' : ''}${returnBlock}${returnFromBlock}` +
        `${getBlock('r')}${getBlock('g')}${getBlock('b')}`);
    // Flyout blocks can receive their category/theme colour after domToMutation.
    // Re-apply the shader family colour once Blockly has rendered that flyout.
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const flyout = workspace.getFlyout && workspace.getFlyout();
            const flyoutWorkspace = flyout && flyout.getWorkspace && flyout.getWorkspace();
            if (!flyoutWorkspace) return;
            for (const block of flyoutWorkspace.getAllBlocks()) {
                if (block.type === SHADER_CALL_OPCODE) {
                    lockShaderColour(block);
                }
            }
        }));
    }
    return result;
};

const registerMyBlocksShaderCategory = (ScratchBlocks, workspace) => {
    defineShaderBlocks(ScratchBlocks);
    workspace.registerToolboxCategoryCallback(CATEGORY_CALLBACK, shaderFlyout.bind(null, ScratchBlocks));
    recolorMyBlocksShaderDefinitions(workspace);
};

const installMyBlocksShaderBlocks = ScratchBlocks => {
    defineShaderBlocks(ScratchBlocks);
    const workspacePrototype = ScratchBlocks.WorkspaceSvg && ScratchBlocks.WorkspaceSvg.prototype;
    if (!workspacePrototype || workspacePrototype.myBlocksShaderCategoryPatched_) return;
    workspacePrototype.myBlocksShaderCategoryPatched_ = true;
    const originalRegister = workspacePrototype.registerToolboxCategoryCallback;
    workspacePrototype.registerToolboxCategoryCallback = function (name, callback) {
        const result = originalRegister.call(this, name, callback);
        if (!this.getToolboxCategoryCallback(CATEGORY_CALLBACK)) {
            originalRegister.call(this, CATEGORY_CALLBACK, shaderFlyout.bind(null, ScratchBlocks));
        }
        return result;
    };
};

const syncShaderCalls = (ScratchBlocks, workspace, definitionMutation) => {
    const shaderId = definitionMutation.getAttribute('shaderid');
    const callMutation = callMutationFromDefinition(definitionMutation);
    for (const block of workspace.getAllBlocks()) {
        if (block.type === SHADER_CALL_OPCODE &&
            block.myBlocksShaderAttributes_ &&
            block.myBlocksShaderAttributes_.shaderid === shaderId) {
            block.domToMutation(callMutation);
        }
    }
    workspace.refreshToolboxSelection_();
};

export {
    CATEGORY_CALLBACK,
    PRIMARY,
    SECONDARY,
    TERTIARY,
    installMyBlocksShaderBlocks,
    lockShaderColour,
    prepareShaderMutation,
    recolorMyBlocksShaderDefinitions,
    registerMyBlocksShaderCategory,
    stripShaderCoordinates,
    syncShaderCalls
};
