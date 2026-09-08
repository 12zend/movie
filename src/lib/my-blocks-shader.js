// My Blocks Shader compiles Scratch's numeric shader-safe blocks to GLSL and
// applies them to the pen framebuffer in one pass.
// The source is copied before drawing so every get r/g/b sample observes the
// image as it was before this block started.

/* eslint-disable no-console */

const SHADER_MARKER = 'myblocksshader';
const SHADER_CALL_OPCODE = 'procedures_call';
const SHADER_RETURN_OPCODE = 'myblocksshader_return';
const SHADER_RETURN_FROM_OPCODE = 'myblocksshader_return_from';
const SHADER_RETURN_OPCODES = new Set([SHADER_RETURN_OPCODE, SHADER_RETURN_FROM_OPCODE]);
const SHADER_GET_OPCODES = {
    myblocksshader_get_r: 'r',
    myblocksshader_get_g: 'g',
    myblocksshader_get_b: 'b'
};
const MAX_SHADER_LOOP = 256;
const MAX_COMPILED_SHADERS = 64;

// Scratch VM derives extension IDs from the part of an opcode before the
// first underscore. My Blocks Shader owns native-looking Blockly blocks and
// installs its primitives below, but it still needs an extension registration
// so a saved myblocksshader_* opcode can pass the VM's project loader.
class MyBlocksShaderExtension {
    getInfo () {
        return {
            id: SHADER_MARKER,
            name: 'My Blocks Shader',
            blocks: []
        };
    }
}

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

// Keep the GLSL helpers in the Shader compiler so every My Blocks family
// compiler can use exactly the same Scratch-compatible numeric operations.
const SHADER_COMPILER_HELPERS = `
float shaderScratchDivide(float numerator, float denominator) {
    if (denominator != 0.0) return numerator / denominator;
    if (numerator > 0.0) return 1e20;
    if (numerator < 0.0) return -1e20;
    return 0.0;
}

float shaderScratchMod(float numerator, float denominator) {
    return denominator == 0.0 ? 0.0 : mod(numerator, denominator);
}

float shaderScratchTan(float value) {
    float angle = mod(mod(value, 360.0) + 360.0, 360.0);
    if (abs(angle - 90.0) < 0.000001) return 1e20;
    if (abs(angle - 270.0) < 0.000001) return -1e20;
    return tan(radians(value));
}

float shaderHash(vec3 value) {
    return fract(sin(dot(value, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}`;

const numberLiteral = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0.0';
    if (Object.is(number, -0)) return '0.0';
    const text = String(number);
    return /[.eE]/.test(text) ? text : `${text}.0`;
};

const parseJSON = (value, fallback = []) => {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch (error) {
        return fallback;
    }
};

const safeIdentifier = (value, prefix = 'u_arg_') => {
    const sanitized = String(value)
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    return `${prefix}${sanitized || 'value'}`;
};

const blockField = (block, name, fallback = '') => {
    const field = block && block.fields && block.fields[name];
    return field && Object.prototype.hasOwnProperty.call(field, 'value') ? field.value : fallback;
};

class ShaderExpressionCompiler {
    constructor (blocks, argumentNames, argumentIds, options = {}) {
        this.blocks = blocks;
        const hasCompilerOptions = Object.prototype.hasOwnProperty.call(options, 'specialArguments') ||
            Object.prototype.hasOwnProperty.call(options, 'specialExpressions') ||
            Object.prototype.hasOwnProperty.call(options, 'specialConditions');
        this.specialArguments = options.specialArguments || (hasCompilerOptions ? {} : options);
        this.specialExpressions = options.specialExpressions || {};
        this.specialConditions = options.specialConditions || {};
        this.argumentUniforms = new Map();
        this.externalUniforms = new Map();
        this.uniformNames = new Map();
        this.variables = new Map();
        this.variableNames = new Map();
        this.functions = new Map();
        this.procedureNames = new Map();
        this.compilingProcedures = new Set();
        this.scope = null;
        this.isReporterFunction = false;
        this.loopCounter = 0;
        this.randomCounter = 0;
        for (let i = 0; i < argumentIds.length; i++) {
            this.argumentUniforms.set(argumentNames[i], safeIdentifier(argumentIds[i]));
        }
    }

    block (blockId) {
        return blockId && this.blocks[blockId];
    }

    inputId (block, name) {
        if (!block || !block.inputs || !block.inputs[name]) return null;
        const input = block.inputs[name];
        return input.block === null || !Object.prototype.hasOwnProperty.call(input, 'block') ?
            input.shadow : input.block;
    }

    input (block, name, fallback = '0.0') {
        return this.expression(this.inputId(block, name), fallback);
    }

    binary (block, left, operator, right, fallback) {
        return `((${this.input(block, left, fallback)}) ${operator} (${this.input(block, right, fallback)}))`;
    }

    literalNumber (blockId) {
        const block = this.block(blockId);
        if (!block) return null;
        if (['math_number', 'math_integer', 'math_whole_number', 'math_positive_number', 'math_angle']
            .includes(block.opcode)) {
            const value = Number(blockField(block, 'NUM', 0));
            return Number.isFinite(value) ? value : 0;
        }
        if (block.opcode === 'text') {
            const value = Number(blockField(block, 'TEXT', 0));
            return Number.isFinite(value) ? value : 0;
        }
        return null;
    }

    constantString (blockId, literalOnly = false) {
        const block = this.block(blockId);
        if (!block) return null;
        if (block.opcode === 'text') return String(blockField(block, 'TEXT'));
        if (['math_number', 'math_integer', 'math_whole_number', 'math_positive_number', 'math_angle']
            .includes(block.opcode)) {
            return literalOnly ? null : String(blockField(block, 'NUM', 0));
        }
        if (block.opcode === 'operator_join') {
            const left = this.constantString(this.inputId(block, 'STRING1'), literalOnly);
            const right = this.constantString(this.inputId(block, 'STRING2'), literalOnly);
            return left === null || right === null ? null : left + right;
        }
        if (block.opcode === 'operator_letter_of') {
            const value = this.constantString(this.inputId(block, 'STRING'), literalOnly);
            const index = this.literalNumber(this.inputId(block, 'LETTER'));
            if (value === null || index === null) return null;
            const offset = Math.floor(index) - 1;
            return offset >= 0 && offset < value.length ? value[offset] : '';
        }
        if (block.opcode === 'operator_length') {
            const value = this.constantString(this.inputId(block, 'STRING'), literalOnly);
            return value === null ? null : String(value.length);
        }
        if (block.opcode === 'operator_contains') {
            const value = this.constantString(this.inputId(block, 'STRING1'), literalOnly);
            const search = this.constantString(this.inputId(block, 'STRING2'), literalOnly);
            if (value === null || search === null) return null;
            return value.toLowerCase().includes(search.toLowerCase()) ? 'true' : 'false';
        }
        return null;
    }

    constantComparison (block, operator) {
        const left = this.constantString(this.inputId(block, 'OPERAND1'), true);
        const right = this.constantString(this.inputId(block, 'OPERAND2'), true);
        if (left === null || right === null) return null;
        if (operator === '<') return left.toLowerCase() < right.toLowerCase();
        if (operator === '>') return left.toLowerCase() > right.toLowerCase();
        return left.toLowerCase() === right.toLowerCase();
    }

    uniform (kind, key, descriptor) {
        const logicalKey = `${kind}:${key}`;
        if (this.uniformNames.has(logicalKey)) return this.uniformNames.get(logicalKey);
        const base = safeIdentifier(key, `u_${kind}_`);
        let name = base;
        let suffix = 2;
        while (this.externalUniforms.has(name)) name = `${base}_${suffix++}`;
        this.uniformNames.set(logicalKey, name);
        if (!this.externalUniforms.has(name)) {
            this.externalUniforms.set(name, Object.assign({kind, key}, descriptor));
        }
        return name;
    }

    variable (block) {
        const field = block && block.fields && block.fields.VARIABLE;
        const name = String(field && Object.prototype.hasOwnProperty.call(field, 'value') ?
            field.value : 'variable');
        const id = field && field.id;
        const key = id || name;
        if (this.variableNames.has(key)) return this.variableNames.get(key);
        const base = safeIdentifier(key, 's_var_');
        let glslName = base;
        let suffix = 2;
        while (this.variables.has(glslName)) glslName = `${base}_${suffix++}`;
        this.variableNames.set(key, glslName);
        if (!this.variables.has(glslName)) {
            const uniformName = this.uniform('var', key, {id, scratchName: name});
            this.variables.set(glslName, uniformName);
        }
        return glslName;
    }

    reporterUniform (block, args = {}) {
        const detail = JSON.stringify(args);
        return this.uniform('reporter', `${block.opcode}_${detail}`, {opcode: block.opcode, args});
    }

    listUniform (block, operation, extra = {}) {
        const field = block && block.fields && block.fields.LIST;
        const scratchName = String(field && Object.prototype.hasOwnProperty.call(field, 'value') ?
            field.value : 'list');
        const id = field && field.id;
        const key = `${id || scratchName}_${operation}_${JSON.stringify(extra)}`;
        return this.uniform('list', key, {id, scratchName, operation, extra});
    }

    menuValue (block, inputName, fieldName) {
        const ownValue = blockField(block, fieldName, null);
        if (ownValue !== null) return String(ownValue);
        const child = this.block(this.inputId(block, inputName));
        const childValue = blockField(child, fieldName, null);
        if (childValue !== null) return String(childValue);
        return this.constantString(this.inputId(block, inputName));
    }

    condition (block, name) {
        const child = this.block(this.inputId(block, name));
        if (!child) return `(${this.input(block, name)} != 0.0)`;
        const specialCondition = this.specialConditions[child.opcode];
        if (typeof specialCondition !== 'undefined') {
            return typeof specialCondition === 'function' ? specialCondition(child, this) : specialCondition;
        }
        switch (child.opcode) {
        case 'operator_lt': {
            const constant = this.constantComparison(child, '<');
            if (constant !== null) return constant ? '(true)' : '(false)';
            return `((${this.input(child, 'OPERAND1')}) < (${this.input(child, 'OPERAND2')}))`;
        }
        case 'operator_gt': {
            const constant = this.constantComparison(child, '>');
            if (constant !== null) return constant ? '(true)' : '(false)';
            return `((${this.input(child, 'OPERAND1')}) > (${this.input(child, 'OPERAND2')}))`;
        }
        case 'operator_equals': {
            const constant = this.constantComparison(child, '=');
            if (constant !== null) return constant ? '(true)' : '(false)';
            return `(abs((${this.input(child, 'OPERAND1')}) - (${this.input(child, 'OPERAND2')})) < 0.000001)`;
        }
        case 'operator_and':
            return `(${this.condition(child, 'OPERAND1')} && ${this.condition(child, 'OPERAND2')})`;
        case 'operator_or':
            return `(${this.condition(child, 'OPERAND1')} || ${this.condition(child, 'OPERAND2')})`;
        case 'operator_not':
            return `(!${this.condition(child, 'OPERAND')})`;
        default:
            return `((${this.expression(this.inputId(block, name))}) != 0.0)`;
        }
    }

    statements (headId, stopId = null, indent = '    ') {
        const result = [];
        let id = headId;
        while (id && id !== stopId) {
            const block = this.block(id);
            if (!block || SHADER_RETURN_OPCODES.has(block.opcode)) break;
            result.push(this.statement(block, indent));
            id = block.next;
        }
        return result.filter(Boolean).join('\n');
    }

    substack (block, name, indent) {
        return this.statements(this.inputId(block, name), null, indent);
    }

    statement (block, indent) {
        switch (block.opcode) {
        case 'data_setvariableto':
            return `${indent}${this.variable(block)} = ${this.input(block, 'VALUE')};`;
        case 'data_changevariableby':
            return `${indent}${this.variable(block)} += ${this.input(block, 'VALUE')};`;
        case 'control_if': {
            const body = this.substack(block, 'SUBSTACK', `${indent}    `);
            return `${indent}if (${this.condition(block, 'CONDITION')}) {\n${body}\n${indent}}`;
        }
        case 'control_if_else': {
            const first = this.substack(block, 'SUBSTACK', `${indent}    `);
            const second = this.substack(block, 'SUBSTACK2', `${indent}    `);
            return `${indent}if (${this.condition(block, 'CONDITION')}) {\n${first}\n${indent}} else {\n` +
                `${second}\n${indent}}`;
        }
        case 'control_repeat': {
            const loop = safeIdentifier(this.loopCounter++, 's_loop_');
            const body = this.substack(block, 'SUBSTACK', `${indent}    `);
            return `${indent}for (int ${loop} = 0; ${loop} < ${MAX_SHADER_LOOP}; ${loop}++) {\n` +
                `${indent}    if (float(${loop}) >= ${this.input(block, 'TIMES')}) break;\n${body}\n${indent}}`;
        }
        case 'control_repeat_until':
        case 'control_while': {
            const loop = safeIdentifier(this.loopCounter++, 's_loop_');
            const body = this.substack(block, 'SUBSTACK', `${indent}    `);
            const condition = this.condition(block, 'CONDITION');
            const shouldBreak = block.opcode === 'control_repeat_until' ? condition : `!(${condition})`;
            return `${indent}for (int ${loop} = 0; ${loop} < ${MAX_SHADER_LOOP}; ${loop}++) {\n` +
                `${indent}    if (${shouldBreak}) break;\n${body}\n${indent}}`;
        }
        case 'control_for_each': {
            const loop = safeIdentifier(this.loopCounter++, 's_loop_');
            const body = this.substack(block, 'SUBSTACK', `${indent}    `);
            const variable = this.variable(block);
            return `${indent}for (int ${loop} = 0; ${loop} < ${MAX_SHADER_LOOP}; ${loop}++) {\n` +
                `${indent}    if (float(${loop}) >= ${this.input(block, 'VALUE')}) break;\n` +
                `${indent}    ${variable} = float(${loop}) + 1.0;\n${body}\n${indent}}`;
        }
        case 'control_forever': {
            const loop = safeIdentifier(this.loopCounter++, 's_loop_');
            const body = this.substack(block, 'SUBSTACK', `${indent}    `);
            return `${indent}for (int ${loop} = 0; ${loop} < ${MAX_SHADER_LOOP}; ${loop}++) {\n${body}\n${indent}}`;
        }
        case 'control_all_at_once':
            return this.substack(block, 'SUBSTACK', indent);
        case 'procedures_call':
            return `${indent}${this.procedureCall(block)};`;
        case 'procedures_return':
            return `${indent}return ${this.input(block, 'VALUE')};`;
        case 'control_stop':
            return this.isReporterFunction ? `${indent}return 0.0;` : `${indent}return;`;
        case 'control_wait':
        case 'control_wait_until':
        case 'control_clear_counter':
        case 'control_incr_counter':
            return '';
        default:
            // Commands which do not have a per-pixel GPU meaning retain the
            // previous behavior: they are skipped without yielding the VM.
            return '';
        }
    }

    procedureInfo (procedureCode) {
        for (const prototype of Object.values(this.blocks)) {
            if (prototype.opcode !== 'procedures_prototype' || !prototype.mutation) continue;
            if (prototype.mutation[SHADER_MARKER] === 'true') continue;
            if (prototype.mutation.proccode !== procedureCode) continue;
            const definition = this.block(prototype.parent);
            if (!definition || definition.opcode !== 'procedures_definition') return null;
            return {prototype, definition};
        }
        return null;
    }

    procedureCall (block, reporterRequired = false) {
        const procedureCode = block.mutation && block.mutation.proccode;
        const info = this.procedureInfo(procedureCode);
        if (!info) throw new Error(`Unknown custom block in shader: ${procedureCode}`);
        if (reporterRequired && !this.procedureIsReporter(info)) {
            throw new Error(`Custom command used as a shader reporter: ${procedureCode}`);
        }
        const functionName = this.compileProcedure(procedureCode, info);
        const argumentIds = parseJSON(block.mutation.argumentids,
            parseJSON(info.prototype.mutation.argumentids));
        const defaults = parseJSON(info.prototype.mutation.argumentdefaults);
        const args = argumentIds.map((id, index) => {
            const childId = this.inputId(block, id);
            return childId ? this.expression(childId) : numberLiteral(defaults[index]);
        });
        return `${functionName}(${args.join(', ')})`;
    }

    procedureIsReporter (info) {
        if (String(info.prototype.mutation.return) === 'true') return true;
        const visit = blockId => {
            const block = this.block(blockId);
            if (!block) return false;
            if (block.opcode === 'procedures_return') return true;
            for (const input of Object.values(block.inputs || {})) {
                const childId = input.block === null || !Object.prototype.hasOwnProperty.call(input, 'block') ?
                    input.shadow : input.block;
                if (visit(childId)) return true;
            }
            return visit(block.next);
        };
        return visit(info.definition.next);
    }

    compileProcedure (procedureCode, info) {
        let functionName = this.procedureNames.get(procedureCode);
        if (!functionName) {
            const base = safeIdentifier(procedureCode, 's_proc_');
            functionName = base;
            let suffix = 2;
            const usedNames = new Set(this.procedureNames.values());
            while (usedNames.has(functionName)) functionName = `${base}_${suffix++}`;
            this.procedureNames.set(procedureCode, functionName);
        }
        if (this.functions.has(procedureCode)) return functionName;
        if (this.compilingProcedures.has(procedureCode)) {
            throw new Error(`Recursion is not supported in shaders: ${procedureCode}`);
        }
        this.compilingProcedures.add(procedureCode);
        const names = parseJSON(info.prototype.mutation.argumentnames);
        const ids = parseJSON(info.prototype.mutation.argumentids);
        const isReporter = this.procedureIsReporter(info);
        const parameters = ids.map((id, index) => safeIdentifier(id || index, 's_arg_'));
        const previousScope = this.scope;
        const previousReporter = this.isReporterFunction;
        this.scope = new Map();
        for (let i = 0; i < names.length; i++) this.scope.set(String(names[i]), parameters[i]);
        this.isReporterFunction = isReporter;
        const body = this.statements(info.definition.next, null, '    ');
        const fallback = isReporter ? '\n    return 0.0;' : '';
        const returnType = isReporter ? 'float' : 'void';
        const declaration = parameters.map(name => `float ${name}`).join(', ');
        this.functions.set(procedureCode,
            `${returnType} ${functionName}(${declaration}) {\n${body}${fallback}\n}`);
        this.scope = previousScope;
        this.isReporterFunction = previousReporter;
        this.compilingProcedures.delete(procedureCode);
        return functionName;
    }

    expression (blockId, fallback = '0.0') {
        const block = this.block(blockId);
        if (!block) return fallback;

        const specialExpression = this.specialExpressions[block.opcode];
        if (typeof specialExpression !== 'undefined') {
            return typeof specialExpression === 'function' ? specialExpression(block, this) : specialExpression;
        }

        switch (block.opcode) {
        case 'math_number':
        case 'math_integer':
        case 'math_whole_number':
        case 'math_positive_number':
        case 'math_angle':
            return numberLiteral(blockField(block, 'NUM', 0));
        case 'text':
            return numberLiteral(blockField(block, 'TEXT', 0));
        case 'argument_reporter_string_number':
        case 'argument_reporter_boolean': {
            const name = String(blockField(block, 'VALUE'));
            if (Object.prototype.hasOwnProperty.call(this.specialArguments, name)) {
                return this.specialArguments[name];
            }
            if (name === 'cx') return 'cx';
            if (name === 'cy') return 'cy';
            if (/^(is compiled\?|is turbowarp\?)$/i.test(name)) return '1.0';
            return (this.scope && this.scope.get(name)) || this.argumentUniforms.get(name) || '0.0';
        }
        case 'data_variable':
            return this.variable(block);
        case 'motion_xposition':
        case 'motion_yposition':
        case 'motion_direction':
        case 'looks_size':
        case 'sound_volume':
        case 'sensing_timer':
        case 'sensing_mousex':
        case 'sensing_mousey':
        case 'sensing_mousedown':
        case 'sensing_dayssince2000':
        case 'sensing_answer':
        case 'sensing_loudness':
        case 'sensing_loud':
        case 'sensing_online':
        case 'control_get_counter':
            return this.reporterUniform(block);
        case 'looks_costumenumbername':
            return this.reporterUniform(block, {NUMBER_NAME: blockField(block, 'NUMBER_NAME', 'number')});
        case 'looks_backdropnumbername':
            return this.reporterUniform(block, {NUMBER_NAME: blockField(block, 'NUMBER_NAME', 'number')});
        case 'sensing_current':
            return this.reporterUniform(block, {CURRENTMENU: blockField(block, 'CURRENTMENU', '')});
        case 'sensing_keypressed': {
            const key = this.menuValue(block, 'KEY_OPTION', 'KEY_OPTION');
            if (key === null) throw new Error('Shader key pressed block needs a fixed key menu value.');
            return this.reporterUniform(block, {KEY_OPTION: key});
        }
        case 'sensing_distanceto': {
            const target = this.menuValue(block, 'DISTANCETOMENU', 'DISTANCETOMENU');
            if (target === null) throw new Error('Shader distance block needs a fixed target menu value.');
            return this.reporterUniform(block, {DISTANCETOMENU: target});
        }
        case 'sensing_of': {
            const object = this.menuValue(block, 'OBJECT', 'OBJECT');
            if (object === null) throw new Error('Shader attribute block needs a fixed object value.');
            return this.reporterUniform(block, {PROPERTY: blockField(block, 'PROPERTY', ''), OBJECT: object});
        }
        case 'operator_add':
            return this.binary(block, 'NUM1', '+', 'NUM2', '0.0');
        case 'operator_subtract':
            return this.binary(block, 'NUM1', '-', 'NUM2', '0.0');
        case 'operator_multiply':
            return this.binary(block, 'NUM1', '*', 'NUM2', '0.0');
        case 'operator_divide':
            return `shaderScratchDivide(${this.input(block, 'NUM1')}, ${this.input(block, 'NUM2')})`;
        case 'operator_mod':
            return `shaderScratchMod(${this.input(block, 'NUM1')}, ${this.input(block, 'NUM2')})`;
        case 'operator_round':
            return `floor((${this.input(block, 'NUM')}) + 0.5)`;
        case 'operator_lt': {
            const constant = this.constantComparison(block, '<');
            if (constant !== null) return constant ? '1.0' : '0.0';
            return `((${this.input(block, 'OPERAND1')}) < (${this.input(block, 'OPERAND2')}) ? 1.0 : 0.0)`;
        }
        case 'operator_gt': {
            const constant = this.constantComparison(block, '>');
            if (constant !== null) return constant ? '1.0' : '0.0';
            return `((${this.input(block, 'OPERAND1')}) > (${this.input(block, 'OPERAND2')}) ? 1.0 : 0.0)`;
        }
        case 'operator_equals': {
            const constant = this.constantComparison(block, '=');
            if (constant !== null) return constant ? '1.0' : '0.0';
            return `(abs((${this.input(block, 'OPERAND1')}) - ` +
                `(${this.input(block, 'OPERAND2')})) < 0.000001 ? 1.0 : 0.0)`;
        }
        case 'operator_and':
            return `(((${this.input(block, 'OPERAND1')}) != 0.0 && ` +
                `(${this.input(block, 'OPERAND2')}) != 0.0) ? 1.0 : 0.0)`;
        case 'operator_or':
            return `(((${this.input(block, 'OPERAND1')}) != 0.0 || ` +
                `(${this.input(block, 'OPERAND2')}) != 0.0) ? 1.0 : 0.0)`;
        case 'operator_not':
            return `((${this.input(block, 'OPERAND')}) == 0.0 ? 1.0 : 0.0)`;
        case 'operator_mathop':
            return this.mathOperation(block);
        case 'operator_random': {
            const from = this.input(block, 'FROM');
            const to = this.input(block, 'TO');
            const fromLiteral = this.literalNumber(this.inputId(block, 'FROM'));
            const toLiteral = this.literalNumber(this.inputId(block, 'TO'));
            const random = `shaderHash(vec3(cx, cy, u_random_seed + ${numberLiteral(this.randomCounter++)}))`;
            if (Number.isInteger(fromLiteral) && Number.isInteger(toLiteral)) {
                const low = Math.min(fromLiteral, toLiteral);
                const high = Math.max(fromLiteral, toLiteral);
                return `floor(mix(${numberLiteral(low)}, ${numberLiteral(high + 1)}, ${random}))`;
            }
            return `mix((${from}), (${to}), ${random})`;
        }
        case 'operator_join': {
            const value = this.constantString(blockId);
            // GLSL has no native string type. Literal strings still have the
            // same numeric coercion Scratch applies when they feed an RGB
            // input; dynamic strings are a safe numeric fallback instead of
            // making the whole scene/shader fail to compile.
            if (value === null) return '0.0';
            return numberLiteral(value);
        }
        case 'operator_length': {
            const value = this.constantString(this.inputId(block, 'STRING'));
            if (value === null) return '0.0';
            return numberLiteral(value.length);
        }
        case 'operator_letter_of': {
            const value = this.constantString(blockId);
            if (value === null) return '0.0';
            return numberLiteral(value);
        }
        case 'operator_contains': {
            const value = this.constantString(this.inputId(block, 'STRING1'));
            const search = this.constantString(this.inputId(block, 'STRING2'));
            if (value === null || search === null) return '0.0';
            return value.toLowerCase().includes(search.toLowerCase()) ? '1.0' : '0.0';
        }
        case 'data_lengthoflist':
            return this.listUniform(block, 'length');
        case 'data_itemoflist': {
            const text = this.constantString(this.inputId(block, 'INDEX'));
            const numericIndex = Number(text);
            const index = text !== null && Number.isFinite(numericIndex) ? numericIndex : null;
            if (text !== 'last' && index === null) {
                throw new Error('Shader list item needs a fixed numeric index or "last".');
            }
            return this.listUniform(block, 'item', {index: text === 'last' ? 'last' : index});
        }
        case 'data_itemnumoflist':
        case 'data_listcontainsitem': {
            const item = this.constantString(this.inputId(block, 'ITEM'));
            if (item === null) throw new Error('Shader list search needs a fixed item.');
            const operation = block.opcode === 'data_itemnumoflist' ? 'indexOf' : 'contains';
            return this.listUniform(block, operation, {item});
        }
        case 'procedures_call':
            return this.procedureCall(block, true);
        default:
            if (Object.prototype.hasOwnProperty.call(SHADER_GET_OPCODES, block.opcode)) {
                const channel = SHADER_GET_OPCODES[block.opcode];
                return `shaderSample(${this.input(block, 'X')}, ${this.input(block, 'Y')}).${channel}`;
            }
            throw new Error(`Unsupported block in shader expression: ${block.opcode}`);
        }
    }

    mathOperation (block) {
        const value = this.input(block, 'NUM');
        switch (String(blockField(block, 'OPERATOR')).toLowerCase()) {
        case 'abs': return `abs(${value})`;
        case 'floor': return `floor(${value})`;
        case 'ceiling': return `ceil(${value})`;
        case 'sqrt': return `((${value}) < 0.0 ? 0.0 : sqrt(${value}))`;
        case 'sin': return `sin(radians(${value}))`;
        case 'cos': return `cos(radians(${value}))`;
        case 'tan': return `shaderScratchTan(${value})`;
        case 'asin': return `degrees(asin(clamp(${value}, -1.0, 1.0)))`;
        case 'acos': return `degrees(acos(clamp(${value}, -1.0, 1.0)))`;
        case 'atan': return `degrees(atan(${value}))`;
        case 'ln': return `((${value}) <= 0.0 ? 0.0 : log(${value}))`;
        case 'log': return `((${value}) <= 0.0 ? 0.0 : (log(${value}) / 2.302585092994046))`;
        case 'e ^': return `exp(${value})`;
        case '10 ^': return `pow(10.0, ${value})`;
        default: return value;
        }
    }
}

class MyBlocksShaderEngine {
    constructor (renderer) {
        this.renderer = renderer;
        this.gl = renderer && (renderer._gl || renderer.gl);
        this.vertexShader = null;
        this.quad = null;
        this.width = 0;
        this.height = 0;
        this.sourceTexture = null;
        this.sourceFramebuffer = null;
        this.programs = new Map();
        this.locations = new WeakMap();
        this.positions = new WeakMap();
    }

    _initialize () {
        const gl = this.gl;
        if (!gl || this.vertexShader) return Boolean(gl);
        this.vertexShader = this._compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
        this.quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, 1, 1
        ]), gl.STATIC_DRAW);
        return true;
    }

    _compileShader (type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader) || 'Unknown GLSL compile error';
            gl.deleteShader(shader);
            throw new Error(message);
        }
        return shader;
    }

    _program (source) {
        if (this.programs.has(source)) return this.programs.get(source);
        const gl = this.gl;
        const fragmentShader = this._compileShader(gl.FRAGMENT_SHADER, source);
        const program = gl.createProgram();
        try {
            gl.attachShader(program, this.vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
        } finally {
            gl.deleteShader(fragmentShader);
        }
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const message = gl.getProgramInfoLog(program) || 'Unknown GLSL link error';
            gl.deleteProgram(program);
            throw new Error(message);
        }
        this.programs.set(source, program);
        return program;
    }

    _penSkin () {
        const id = this.renderer && this.renderer._penSkinId;
        return Number.isInteger(id) ? this.renderer._allSkins[id] : null;
    }

    _resize (width, height) {
        if (this.width === width && this.height === height) return;
        const gl = this.gl;
        if (this.sourceFramebuffer) gl.deleteFramebuffer(this.sourceFramebuffer);
        if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
        this.width = width;
        this.height = height;
        this.sourceTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.sourceFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sourceFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sourceTexture, 0);
    }

    _location (program, name) {
        let map = this.locations.get(program);
        if (!map) {
            map = new Map();
            this.locations.set(program, map);
        }
        if (!map.has(name)) map.set(name, this.gl.getUniformLocation(program, name));
        return map.get(name);
    }

    _position (program) {
        if (!this.positions.has(program)) {
            this.positions.set(program, this.gl.getAttribLocation(program, 'a_position'));
        }
        return this.positions.get(program);
    }

    _draw (program, framebuffer, texture, uniforms) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(program);
        const position = this._position(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(this._location(program, 'u_image'), 0);
        const resolution = this._location(program, 'u_resolution');
        gl.uniform2f(resolution, this.width, this.height);
        for (const name of Object.keys(uniforms)) {
            gl.uniform1f(this._location(program, name), uniforms[name]);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    apply (source, uniforms) {
        if (!this._initialize()) return;
        const skin = this._penSkin();
        if (!skin || !skin._texture || !skin._framebuffer || !skin._size) return;
        const gl = this.gl;
        if (typeof this.renderer._doExitDrawRegion === 'function') this.renderer._doExitDrawRegion();
        this._resize(skin._size[0], skin._size[1]);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.BLEND);

        const copyProgram = this._program(`
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
void main() { gl_FragColor = texture2D(u_image, v_uv); }`);
        this._draw(copyProgram, this.sourceFramebuffer, skin._texture, {});
        const target = skin._framebuffer.framebuffer || skin._framebuffer;
        this._draw(this._program(source), target, this.sourceTexture, uniforms);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        skin._silhouetteDirty = true;
        if (typeof skin.emitWasAltered === 'function') skin.emitWasAltered();
        this.renderer.dirty = true;
    }
}

class MyBlocksShaderManager {
    constructor (vm) {
        this.vm = vm;
        this.runtime = vm.runtime;
        this.engine = new MyBlocksShaderEngine(this.runtime.renderer);
        this.errors = new Set();
        this.randomSeed = 0;
        // Compiled GLSL artifacts keyed by a content signature of the definition subtree, so editing
        // the definition misses the cache naturally while steady per-frame execution reuses it.
        this.compiledShaders = new Map();
        // Self-validating definition locations per blocks store, avoiding a full scan per execution.
        this.definitionIndexes = new WeakMap();
        if (vm && typeof vm.on === 'function') {
            // Deduplicated error messages must not suppress reporting the same failure after a
            // different project has been loaded into the same runtime.
            vm.on('project-loaded', () => this.errors.clear());
        }
    }

    _prototypeMatches (prototype, shaderId, userProcCode) {
        const mutation = prototype && prototype.mutation;
        if (!mutation || mutation[SHADER_MARKER] !== 'true') return false;
        return Boolean((shaderId && mutation.shaderid === shaderId) ||
            (userProcCode && mutation.shaderuserproccode === userProcCode));
    }

    _scanForPrototype (blocks, shaderId, userProcCode) {
        for (const block of Object.values(blocks)) {
            if (block.opcode !== 'procedures_prototype' || !block.mutation) continue;
            if (this._prototypeMatches(block, shaderId, userProcCode)) return block;
        }
        return null;
    }

    _definitionFromPrototype (blocks, prototype) {
        if (!prototype) return null;
        const definition = blocks[prototype.parent];
        return definition && definition.opcode === 'procedures_definition' ? definition : null;
    }

    _findDefinition (target, shaderId, userProcCode) {
        const blocks = target && target.blocks && target.blocks._blocks;
        if (!blocks) return null;
        let index = this.definitionIndexes.get(blocks);
        if (!index) {
            index = {byCode: new Map(), byId: null};
            this.definitionIndexes.set(blocks, index);
        }
        let prototype;
        if (shaderId) {
            if (!this._prototypeMatches(index.byId, shaderId, null)) index.byId = null;
            if (!index.byId) index.byId = this._scanForPrototype(blocks, shaderId, null);
            prototype = index.byId;
        } else {
            prototype = index.byCode.get(userProcCode);
            if (!this._prototypeMatches(prototype, null, userProcCode)) {
                prototype = this._scanForPrototype(blocks, null, userProcCode);
                index.byCode.set(userProcCode, prototype);
            }
        }
        return this._definitionFromPrototype(blocks, prototype);
    }

    _findReturn (blocks, definition) {
        let id = definition && definition.next;
        while (id) {
            const block = blocks[id];
            if (!block) return null;
            if (SHADER_RETURN_OPCODES.has(block.opcode)) return {block, id};
            id = block.next;
        }
        return null;
    }

    _source (definition, returnInfo, compiler, argumentUniformNames) {
        const returnBlock = returnInfo.block;
        const statements = compiler.statements(definition.next, returnInfo.id);
        let returnedColor;
        if (returnBlock.opcode === SHADER_RETURN_FROM_OPCODE) {
            returnedColor = `shaderSample(${compiler.input(returnBlock, 'X')}, ` +
                `${compiler.input(returnBlock, 'Y')})`;
        } else {
            returnedColor = `vec3(${compiler.input(returnBlock, 'R')}, ` +
                `${compiler.input(returnBlock, 'G')}, ${compiler.input(returnBlock, 'B')})`;
        }
        const externalUniformNames = Array.from(compiler.externalUniforms.keys());
        const declarations = argumentUniformNames.concat(externalUniformNames)
            .map(name => `uniform float ${name};`)
            .join('\n');
        const variables = Array.from(compiler.variables.keys())
            .map(name => `float ${name};`)
            .join('\n');
        const variableInitializers = Array.from(compiler.variables.entries())
            .map(([name, uniform]) => `    ${name} = ${uniform};`)
            .join('\n');
        const functions = Array.from(compiler.functions.values()).join('\n\n');
        return `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_random_seed;
${declarations}
float cx;
float cy;
${variables}

${SHADER_COMPILER_HELPERS}

vec3 shaderSample(float x, float y) {
    vec2 uv = vec2(x / u_resolution.x + 0.5, y / u_resolution.y + 0.5);
    vec4 pixel = texture2D(u_image, clamp(uv, vec2(0.0), vec2(1.0)));
    return pixel.a > 0.00001 ? pixel.rgb / pixel.a : vec3(0.0);
}

${functions}

void main() {
    cx = v_uv.x * u_resolution.x - u_resolution.x * 0.5;
    cy = v_uv.y * u_resolution.y - u_resolution.y * 0.5;
${variableInitializers}
${statements}
    vec4 original = texture2D(u_image, v_uv);
    vec3 shaderColor = clamp(${returnedColor}, 0.0, 1.0);
    gl_FragColor = vec4(shaderColor * original.a, original.a);
}`;
    }

    _findVariable (target, descriptor, type) {
        let variable = null;
        if (target && descriptor.id && typeof target.lookupVariableById === 'function') {
            variable = target.lookupVariableById(descriptor.id);
        }
        if (!variable && target && target.variables && descriptor.id) variable = target.variables[descriptor.id];
        if (!variable && target && typeof target.lookupVariableByNameAndType === 'function') {
            variable = target.lookupVariableByNameAndType(descriptor.scratchName, type);
        }
        if (!variable && this.runtime && typeof this.runtime.getTargetForStage === 'function') {
            const stage = this.runtime.getTargetForStage();
            if (stage && descriptor.id && stage.variables) variable = stage.variables[descriptor.id];
            if (!variable && stage && typeof stage.lookupVariableByNameAndType === 'function') {
                variable = stage.lookupVariableByNameAndType(descriptor.scratchName, type, true);
            }
        }
        return variable;
    }

    _number (value) {
        if (value === true) return 1;
        if (value === false || value === null || value === '') return 0;
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    }

    _listValue (descriptor, target) {
        const variable = this._findVariable(target, descriptor, 'list');
        const list = variable && Array.isArray(variable.value) ? variable.value :
            (Array.isArray(variable) && Array.isArray(variable[1]) ? variable[1] : []);
        switch (descriptor.operation) {
        case 'length':
            return list.length;
        case 'item': {
            const requested = descriptor.extra.index;
            const index = requested === 'last' ? list.length - 1 : Math.floor(Number(requested)) - 1;
            return index >= 0 && index < list.length ? this._number(list[index]) : 0;
        }
        case 'indexOf':
        case 'contains': {
            const expected = descriptor.extra.item;
            const expectedNumber = Number(expected);
            const index = list.findIndex(value => {
                const number = Number(value);
                if (!Number.isNaN(expectedNumber) && !Number.isNaN(number)) return number === expectedNumber;
                return String(value).toLowerCase() === String(expected).toLowerCase();
            });
            return descriptor.operation === 'contains' ? (index === -1 ? 0 : 1) : index + 1;
        }
        default:
            return 0;
        }
    }

    _reporterValue (descriptor, util) {
        const primitive = this.runtime._primitives && this.runtime._primitives[descriptor.opcode];
        if (typeof primitive === 'function') {
            try {
                const result = primitive(Object.assign({}, descriptor.args), util);
                if (!result || typeof result.then !== 'function') return this._number(result);
            } catch (error) {
                // Minimal test runtimes and embedders do not always install all
                // primitives. The property fallbacks below cover common values.
            }
        }
        const target = util && util.target;
        const io = this.runtime.ioDevices || {};
        switch (descriptor.opcode) {
        case 'motion_xposition': return this._number(target && target.x);
        case 'motion_yposition': return this._number(target && target.y);
        case 'motion_direction': return this._number(target && target.direction);
        case 'looks_size': return this._number(target && target.size);
        case 'sound_volume': return this._number(target && target.volume);
        case 'sensing_timer':
            return this._number(io.clock && io.clock.projectTimer && io.clock.projectTimer());
        case 'sensing_mousex':
            return this._number(io.mouse && io.mouse.getScratchX && io.mouse.getScratchX());
        case 'sensing_mousey':
            return this._number(io.mouse && io.mouse.getScratchY && io.mouse.getScratchY());
        case 'sensing_mousedown':
            return this._number(io.mouse && io.mouse.getIsDown && io.mouse.getIsDown());
        case 'sensing_keypressed':
            return this._number(io.keyboard && io.keyboard.getKeyIsDown &&
                io.keyboard.getKeyIsDown(descriptor.args.KEY_OPTION));
        case 'sensing_current': {
            const date = new Date();
            const values = {
                year: date.getFullYear(),
                month: date.getMonth() + 1,
                date: date.getDate(),
                dayofweek: date.getDay() + 1,
                hour: date.getHours(),
                minute: date.getMinutes(),
                second: date.getSeconds()
            };
            return values[String(descriptor.args.CURRENTMENU).toLowerCase()] || 0;
        }
        case 'sensing_dayssince2000':
            return (Date.now() - new Date(2000, 0, 1).valueOf()) / (24 * 60 * 60 * 1000);
        case 'sensing_online':
            return typeof navigator === 'object' && navigator.onLine ? 1 : 0;
        default:
            return 0;
        }
    }

    _externalUniformValue (descriptor, util) {
        if (descriptor.kind === 'var') {
            const variable = this._findVariable(util.target, descriptor, '');
            const value = variable && Object.prototype.hasOwnProperty.call(variable, 'value') ? variable.value :
                (Array.isArray(variable) ? variable[1] : 0);
            return this._number(value);
        }
        if (descriptor.kind === 'list') return this._listValue(descriptor, util.target);
        if (descriptor.kind === 'reporter') return this._reporterValue(descriptor, util);
        return 0;
    }

    // Serialize every block reachable from a definition (opcodes, fields, mutations, input
    // descriptors) into a comparable signature. Any edit to the definition changes the signature,
    // while unchanged per-frame executions keep reusing one compiled artifact.
    _definitionSignature (blocks, startId, parts) {
        const block = blocks[startId];
        if (!block) {
            parts.push('<missing>');
            return;
        }
        parts.push(block.opcode || '');
        if (block.mutation) parts.push(JSON.stringify(block.mutation));
        if (block.fields) parts.push(JSON.stringify(block.fields));
        const inputs = block.inputs;
        if (inputs) {
            for (const name of Object.keys(inputs)) {
                const input = inputs[name];
                parts.push(name);
                this._definitionSignature(blocks, input && input.block, parts);
                this._definitionSignature(blocks, input && input.shadow, parts);
            }
        }
        if (block.next) {
            parts.push('->');
            this._definitionSignature(blocks, block.next, parts);
        }
    }

    _compileDefinition (blocks, definition) {
        const signatureParts = [];
        this._definitionSignature(blocks, definition.inputs.custom_block.block, signatureParts);
        this._definitionSignature(blocks, definition.next, signatureParts);
        const signature = signatureParts.join('\u0000');
        let compiled = this.compiledShaders.get(signature);
        if (!compiled) {
            const prototype = blocks[definition.inputs.custom_block.block];
            const returnInfo = this._findReturn(blocks, definition);
            if (!returnInfo) throw new Error('A shader definition needs a return RGB block.');

            const userNames = parseJSON(prototype.mutation.shaderuserargumentnames);
            const userIds = parseJSON(prototype.mutation.shaderuserargumentids);
            const compiler = new ShaderExpressionCompiler(blocks, userNames, userIds);
            const uniformNames = userIds.map(id => safeIdentifier(id));
            const source = this._source(definition, returnInfo, compiler, uniformNames);
            compiled = {externalUniforms: compiler.externalUniforms, source, uniformNames, userIds};
            if (this.compiledShaders.size >= MAX_COMPILED_SHADERS) this.compiledShaders.clear();
            this.compiledShaders.set(signature, compiled);
        }
        return compiled;
    }

    _applyDefinition (definition, values, util) {
        try {
            const blocks = util.target.blocks._blocks;
            const compiled = this._compileDefinition(blocks, definition);
            const uniforms = {};
            for (let i = 0; i < compiled.userIds.length; i++) {
                const value = Number(values[compiled.userIds[i]]);
                uniforms[compiled.uniformNames[i]] = Number.isFinite(value) ? value : 0;
            }
            for (const [name, descriptor] of compiled.externalUniforms) {
                uniforms[name] = this._externalUniformValue(descriptor, util);
            }
            this.randomSeed = (this.randomSeed + 1) % 1000000;
            uniforms.u_random_seed = this.randomSeed;
            this.engine.apply(compiled.source, uniforms);
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            if (!this.errors.has(message)) {
                this.errors.add(message);
                console.error('[My Blocks Shader]', error);
            }
        }
        // Command primitives must never return a Promise or yield the VM.
        return;
    }

    call (args, util) {
        const mutation = args && args.mutation;
        const definition = this._findDefinition(util.target, mutation && mutation.shaderid);
        if (!definition) return;
        return this._applyDefinition(definition, args, util);
    }

    callProcedure (procedureCode, params, util) {
        const definition = this._findDefinition(util.target, null, procedureCode);
        if (!definition) return;
        const blocks = util.target.blocks._blocks;
        const prototype = blocks[definition.inputs.custom_block.block];
        const names = parseJSON(prototype.mutation.shaderuserargumentnames);
        const ids = parseJSON(prototype.mutation.shaderuserargumentids);
        const values = {};
        for (let i = 0; i < ids.length; i++) values[ids[i]] = params[names[i]];
        return this._applyDefinition(definition, values, util);
    }

    getAddonBlock (procedureCode) {
        const targets = this.runtime.targets || [];
        for (const target of targets) {
            const definition = this._findDefinition(target, null, procedureCode);
            if (!definition) continue;
            const blocks = target.blocks._blocks;
            const prototype = blocks[definition.inputs.custom_block.block];
            const names = parseJSON(prototype.mutation.shaderuserargumentnames);
            const ids = parseJSON(prototype.mutation.shaderuserargumentids);
            const defaults = parseJSON(prototype.mutation.shaderuserargumentdefaults);
            return {
                namesIdsDefaults: [names, ids, defaults],
                // This uses the addon-procedure compiler path internally, but
                // it is a My Blocks family block and must not receive the
                // generic addon block colour in src/addons/api.js.
                myBlocksShader: true,
                callback: (params, util) => this.callProcedure(procedureCode, params, util)
            };
        }
        return null;
    }

    returnRGB () {
        return;
    }

    getChannel () {
        return 0;
    }
}

const installMyBlocksShader = vm => {
    if (vm.runtime.myBlocksShaderManager) return vm.runtime.myBlocksShaderManager;
    const manager = new MyBlocksShaderManager(vm);
    vm.runtime.myBlocksShaderManager = manager;
    vm.runtime._primitives[SHADER_RETURN_OPCODE] = manager.returnRGB.bind(manager);
    vm.runtime._primitives[SHADER_RETURN_FROM_OPCODE] = manager.returnRGB.bind(manager);
    for (const opcode of Object.keys(SHADER_GET_OPCODES)) {
        vm.runtime._primitives[opcode] = manager.getChannel.bind(manager);
    }
    const originalGetAddonBlock = vm.runtime.getAddonBlock.bind(vm.runtime);
    vm.runtime.getAddonBlock = procedureCode => (
        originalGetAddonBlock(procedureCode) || manager.getAddonBlock(procedureCode)
    );

    const extensionManager = vm.extensionManager;
    if (extensionManager &&
        typeof extensionManager.addBuiltinExtension === 'function' &&
        typeof extensionManager.loadExtensionIdSync === 'function') {
        if (!extensionManager.isBuiltinExtension(SHADER_MARKER)) {
            extensionManager.addBuiltinExtension(SHADER_MARKER, MyBlocksShaderExtension);
        }
        if (!extensionManager.isExtensionLoaded(SHADER_MARKER)) {
            extensionManager.loadExtensionIdSync(SHADER_MARKER);
        }
    }
    return manager;
};

export {
    SHADER_CALL_OPCODE,
    SHADER_COMPILER_HELPERS,
    SHADER_GET_OPCODES,
    SHADER_MARKER,
    SHADER_RETURN_FROM_OPCODE,
    SHADER_RETURN_OPCODE,
    MyBlocksShaderManager,
    ShaderExpressionCompiler,
    blockField,
    numberLiteral,
    parseJSON,
    safeIdentifier,
    installMyBlocksShader as default
};
