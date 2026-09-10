/* eslint-disable */

import styles from './pen-fx-ui.css';

const MAX_STOPS = 8;
const DEFAULT_GRADIENT = {
    stops: [
        {color: '#000000', position: 0},
        {color: '#ffffff', position: 1}
    ]
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizeColor = value => {
    const color = String(value || '').trim()
        .toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color)) return color;
    if (/^#[0-9a-f]{3}$/.test(color)) {
        return `#${color.slice(1).split('')
            .map(channel => `${channel}${channel}`)
            .join('')}`;
    }
    return '#000000';
};

const normalizeGradient = value => {
    let descriptor = value;
    if (typeof descriptor === 'string') {
        try {
            descriptor = JSON.parse(descriptor);
        } catch (error) {
            descriptor = null;
        }
    }
    const sourceStops = descriptor && Array.isArray(descriptor.stops) ? descriptor.stops : DEFAULT_GRADIENT.stops;
    const stops = sourceStops.map(stop => ({
        color: normalizeColor(stop && stop.color),
        position: clamp(Number(stop && stop.position) || 0, 0, 1)
    })).slice(0, MAX_STOPS);
    if (stops.length < 2) {
        stops.push({
            color: stops.length ? stops[0].color : '#ffffff',
            position: 1
        });
    }
    stops.sort((a, b) => a.position - b.position);
    return {stops};
};

const serializeGradient = value => JSON.stringify(normalizeGradient(value));

const gradientToCss = value => normalizeGradient(value).stops
    .map(stop => `${stop.color} ${Math.round(stop.position * 100)}%`)
    .join(', ');

const createSvgIcon = (path, className) => {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('stroke-width', '2');
    const shape = document.createElementNS(namespace, 'path');
    shape.setAttribute('d', path);
    svg.appendChild(shape);
    return svg;
};

const getGradientFieldSourceBlock = field => {
    if (field && typeof field.getSourceBlock === 'function') return field.getSourceBlock();
    return field && field.sourceBlock_;
};

const createGradientField = ScratchBlocks => {
    const BaseField = ScratchBlocks.FieldTextInput;
    const GradientField = function (value = serializeGradient(DEFAULT_GRADIENT)) {
        BaseField.call(this, serializeGradient(value));
        this.outsideCloseListener_ = null;
        this.gradientValue_ = serializeGradient(value);
    };
    GradientField.prototype = Object.create(BaseField.prototype);
    GradientField.prototype.constructor = GradientField;

    GradientField.prototype.init = function () {
        BaseField.prototype.init.call(this);
        this.refreshDisplay_();
    };

    GradientField.prototype.getValue = function () {
        return this.gradientValue_ || BaseField.prototype.getValue.call(this);
    };

    GradientField.prototype.setValue = function (value) {
        const serializedValue = serializeGradient(value);
        // Let Blockly compare the serialized value with the previous value before
        // updating our backing value. Otherwise getValue() returns the new value
        // during BaseField#setValue and no BlockChange event reaches the VM.
        BaseField.prototype.setValue.call(this, serializedValue);
        this.gradientValue_ = serializedValue;
        this.refreshDisplay_();
    };

    GradientField.prototype.refreshDisplay_ = function () {
        this.setText('gradient');
        if (this.box_) {
            const stops = normalizeGradient(this.getValue()).stops;
            this.box_.setAttribute('fill', stops[0].color);
        }
    };

    GradientField.prototype.onHide = function () {
        if (this.outsideCloseListener_ && typeof document !== 'undefined') {
            document.removeEventListener('pointerdown', this.outsideCloseListener_, true);
            this.outsideCloseListener_ = null;
        }
        if (typeof BaseField.prototype.onHide === 'function') BaseField.prototype.onHide.call(this);
    };

    GradientField.prototype.showEditor_ = function () {
        if (typeof document === 'undefined' || !document.body) return;
        const sourceBlock = getGradientFieldSourceBlock(this);
        const dropdown = ScratchBlocks.DropDownDiv;
        dropdown.hideWithoutAnimation();
        dropdown.clearContent();

        const content = dropdown.getContentDiv();
        const picker = document.createElement('section');
        picker.className = styles.gradientPicker;
        picker.setAttribute('aria-label', 'Edit gradient');

        const header = document.createElement('div');
        header.className = styles.gradientHeader;
        const headingGroup = document.createElement('div');
        const heading = document.createElement('h2');
        heading.className = styles.gradientHeading;
        heading.textContent = 'Gradient overlay';
        const helper = document.createElement('p');
        helper.className = styles.gradientHelper;
        helper.textContent = 'Use color stops to shape the layer tint.';
        headingGroup.appendChild(heading);
        headingGroup.appendChild(helper);
        const closeButton = document.createElement('button');
        closeButton.className = styles.gradientCloseButton;
        closeButton.type = 'button';
        closeButton.title = 'Close';
        closeButton.setAttribute('aria-label', 'Close gradient editor');
        closeButton.appendChild(createSvgIcon('M6 6l12 12M18 6 6 18', styles.gradientCloseIcon));
        closeButton.addEventListener('click', () => dropdown.hide());
        header.appendChild(headingGroup);
        header.appendChild(closeButton);
        picker.appendChild(header);

        const preview = document.createElement('div');
        preview.className = styles.gradientPreview;
        preview.setAttribute('aria-label', 'Gradient preview');
        picker.appendChild(preview);

        const stopsList = document.createElement('div');
        stopsList.className = styles.gradientStops;
        stopsList.setAttribute('aria-label', 'Gradient stops');
        picker.appendChild(stopsList);

        const footer = document.createElement('div');
        footer.className = styles.gradientFooter;
        const addButton = document.createElement('button');
        addButton.className = styles.gradientAddButton;
        addButton.type = 'button';
        addButton.textContent = 'Add stop';
        footer.appendChild(addButton);
        picker.appendChild(footer);
        content.appendChild(picker);

        let stops = normalizeGradient(this.getValue()).stops;
        const updateField = () => {
            stops = normalizeGradient({stops}).stops;
            this.setValue({stops});
            preview.style.backgroundImage = `linear-gradient(90deg, ${gradientToCss({stops})})`;
            addButton.disabled = stops.length >= MAX_STOPS;
        };

        const makeStopRow = (stop, index) => {
            const row = document.createElement('div');
            row.className = styles.gradientStop;
            const label = document.createElement('span');
            label.className = styles.gradientStopLabel;
            label.textContent = `Stop ${index + 1}`;
            row.appendChild(label);

            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = stop.color;
            colorInput.className = styles.gradientColorInput;
            colorInput.setAttribute('aria-label', `Stop ${index + 1} color`);
            colorInput.addEventListener('input', event => {
                stops[index].color = normalizeColor(event.target.value);
                updateField();
            });
            row.appendChild(colorInput);

            const positionInput = document.createElement('input');
            positionInput.type = 'range';
            positionInput.min = '0';
            positionInput.max = '1';
            positionInput.step = '0.01';
            positionInput.value = String(stop.position);
            positionInput.className = styles.gradientPositionInput;
            positionInput.setAttribute('aria-label', `Stop ${index + 1} position`);
            positionInput.addEventListener('input', event => {
                stops[index].position = clamp(Number(event.target.value) || 0, 0, 1);
                updateField();
            });
            row.appendChild(positionInput);

            const positionLabel = document.createElement('output');
            positionLabel.className = styles.gradientPositionLabel;
            positionLabel.textContent = `${Math.round(stop.position * 100)}%`;
            row.appendChild(positionLabel);

            if (stops.length > 2) {
                const removeButton = document.createElement('button');
                removeButton.className = styles.gradientRemoveButton;
                removeButton.type = 'button';
                removeButton.textContent = 'Remove';
                removeButton.addEventListener('click', () => {
                    stops.splice(index, 1);
                    updateField();
                    // The row renderer is declared below so it can reuse the row factory.
                    // eslint-disable-next-line no-use-before-define
                    renderStops();
                });
                row.appendChild(removeButton);
            }
            return row;
        };

        const renderStops = () => {
            stopsList.textContent = '';
            stops.forEach((stop, index) => stopsList.appendChild(makeStopRow(stop, index)));
        };

        addButton.addEventListener('click', () => {
            if (stops.length >= MAX_STOPS) return;
            const sorted = stops.slice().sort((a, b) => a.position - b.position);
            let largestGap = 0;
            let insertAfter = 0;
            for (let index = 0; index < sorted.length - 1; index++) {
                const gap = sorted[index + 1].position - sorted[index].position;
                if (gap > largestGap) {
                    largestGap = gap;
                    insertAfter = index;
                }
            }
            const left = sorted[insertAfter];
            const right = sorted[insertAfter + 1] || left;
            stops.push({
                color: left.color,
                position: right === left ? clamp(left.position + 0.1, 0, 1) :
                    (left.position + right.position) / 2
            });
            updateField();
            renderStops();
        });

        picker.addEventListener('keydown', event => {
            if (event.key === 'Escape') dropdown.hide();
        });
        this.onHide();
        const boundsElement = sourceBlock && sourceBlock.workspace && sourceBlock.workspace.getParentSvg ?
            sourceBlock.workspace.getParentSvg().parentNode : document.body;
        dropdown.setColour('var(--ui-modal-background)', 'var(--ui-black-transparent)');
        if (sourceBlock && sourceBlock.getCategory) dropdown.setCategory(sourceBlock.getCategory());
        dropdown.setBoundsElement(boundsElement);
        dropdown.showPositionedByBlock(this, sourceBlock, this.onHide.bind(this));
        this.outsideCloseListener_ = event => {
            if (!picker.contains(event.target)) dropdown.hide();
        };
        document.addEventListener('pointerdown', this.outsideCloseListener_, true);
        updateField();
        renderStops();
    };
    return GradientField;
};

const installPenFXBlockDefinitions = ScratchBlocks => {
    if (!ScratchBlocks || !ScratchBlocks.Blocks || !ScratchBlocks.FieldTextInput) return;
    const GradientField = createGradientField(ScratchBlocks);
    ScratchBlocks.Blocks.penfx_gradationOverlay = {
        init: function () {
            this.appendDummyInput('GRADIENT_INPUT')
                .appendField('グラデーションオーバーレイ')
                .appendField(new GradientField(), 'GRADIENT');
            this.appendValueInput('DIR').appendField('向き:');
            this.appendValueInput('MIX')
                .appendField('混合:')
                .appendField('%');
            this.setInputsInline(true);
            this.setColour('#6b56d9', '#5945c2', '#46359f');
            this.setPreviousStatement(true);
            this.setNextStatement(true);
            this.setOutputShape(ScratchBlocks.OUTPUT_SHAPE_SQUARE);
        }
    };
};

export {
    DEFAULT_GRADIENT,
    createGradientField,
    gradientToCss,
    normalizeGradient,
    serializeGradient
};
export default installPenFXBlockDefinitions;
