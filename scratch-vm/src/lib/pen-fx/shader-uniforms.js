const STANDARD_UNIFORM_TYPES = Object.freeze({
    u_image: 'sampler2D',
    u_resolution: 'vec2',
    u_time: 'float',
    u_frame: 'int'
});

const VECTOR_COMPONENTS = ['x', 'y', 'z', 'w'];
const SUPPORTED_TYPES = Object.freeze({
    float: {inputType: 'number', size: 1},
    int: {inputType: 'integer', size: 1},
    bool: {inputType: 'boolean', size: 1},
    vec2: {inputType: 'number', size: 2},
    vec3: {inputType: 'number', size: 3},
    vec4: {inputType: 'number', size: 4},
    ivec2: {inputType: 'integer', size: 2},
    ivec3: {inputType: 'integer', size: 3},
    ivec4: {inputType: 'integer', size: 4},
    bvec2: {inputType: 'boolean', size: 2},
    bvec3: {inputType: 'boolean', size: 3},
    bvec4: {inputType: 'boolean', size: 4}
});

const stripComments = source => {
    const text = String(source || '');
    let result = '';
    let state = 'code';
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        const next = text[index + 1];
        if (state === 'line-comment') {
            if (character === '\n') {
                result += '\n';
                state = 'code';
            } else {
                result += ' ';
            }
        } else if (state === 'block-comment') {
            if (character === '*' && next === '/') {
                result += '  ';
                index++;
                state = 'code';
            } else {
                result += character === '\n' ? '\n' : ' ';
            }
        } else if (character === '/' && next === '/') {
            result += '  ';
            index++;
            state = 'line-comment';
        } else if (character === '/' && next === '*') {
            result += '  ';
            index++;
            state = 'block-comment';
        } else {
            result += character;
        }
    }
    return result;
};

const humanizeUniform = name => String(name || '')
    .replace(/^u_/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase() || 'value';

const baseInputId = name => String(name || '')
    .replace(/^u_/, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || 'VALUE';

const uniqueInputId = (candidate, usedIds) => {
    let id = candidate.slice(0, 32);
    let suffix = 2;
    while (usedIds.has(id)) {
        const suffixText = `_${suffix++}`;
        id = `${candidate.slice(0, 32 - suffixText.length)}${suffixText}`;
    }
    usedIds.add(id);
    return id;
};

const parseShaderUniforms = source => {
    const uncommented = stripComments(source);
    const uniformPattern = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+([^;]+);/g;
    const uniforms = [];
    const seen = new Map();
    let match = uniformPattern.exec(uncommented);
    while (match) {
        const type = match[1];
        const declarations = match[2].split(',');
        for (const declaration of declarations) {
            const declarator = declaration.trim();
            const declaratorMatch = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[\s*([^\]]+)\s*\])?$/.exec(declarator);
            if (!declaratorMatch) {
                throw new Error(`Could not read uniform declaration: ${declarator}.`);
            }
            const name = declaratorMatch[1];
            if (typeof declaratorMatch[2] !== 'undefined') {
                throw new Error(`Uniform arrays are not supported as block inputs: ${name}.`);
            }
            if (seen.has(name)) {
                if (seen.get(name) !== type) throw new Error(`Uniform ${name} is declared with multiple types.`);
                continue;
            }
            seen.set(name, type);
            uniforms.push({name, type});
        }
        match = uniformPattern.exec(uncommented);
    }
    return uniforms;
};

const inferShaderInputs = (source, maximumInputs = 24) => {
    const inputs = [];
    const usedIds = new Set();
    for (const uniform of parseShaderUniforms(source)) {
        if (Object.prototype.hasOwnProperty.call(STANDARD_UNIFORM_TYPES, uniform.name)) {
            if (STANDARD_UNIFORM_TYPES[uniform.name] !== uniform.type) {
                throw new Error(
                    `Standard uniform ${uniform.name} must use type ${STANDARD_UNIFORM_TYPES[uniform.name]}.`
                );
            }
            continue;
        }
        if (uniform.type.indexOf('sampler') === 0) {
            throw new Error(`Only the standard sampler2D uniform u_image is supported: ${uniform.name}.`);
        }
        const typeInfo = SUPPORTED_TYPES[uniform.type];
        if (!typeInfo) throw new Error(`Uniform ${uniform.name} uses unsupported type ${uniform.type}.`);
        const inputId = baseInputId(uniform.name);
        const label = humanizeUniform(uniform.name);
        for (let component = 0; component < typeInfo.size; component++) {
            const isVector = typeInfo.size > 1;
            const componentName = VECTOR_COMPONENTS[component];
            const id = uniqueInputId(isVector ? `${inputId}_${componentName.toUpperCase()}` : inputId, usedIds);
            const input = {
                id,
                label: isVector ? `${label} ${componentName}` : label,
                type: typeInfo.inputType,
                uniform: uniform.name,
                uniformType: uniform.type,
                defaultValue: typeInfo.inputType === 'boolean' ? false : 0
            };
            if (isVector) {
                input.component = component;
                input.vectorSize = typeInfo.size;
            }
            inputs.push(input);
        }
    }
    if (inputs.length > maximumInputs) {
        throw new Error(`Shader uniforms create ${inputs.length} block inputs; the maximum is ${maximumInputs}.`);
    }
    return inputs;
};

export {
    STANDARD_UNIFORM_TYPES,
    SUPPORTED_TYPES,
    inferShaderInputs,
    parseShaderUniforms,
    stripComments
};
