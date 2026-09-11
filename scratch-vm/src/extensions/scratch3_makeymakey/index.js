const formatMessage = require('format-message');
const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');

/**
 * Icon svg to be displayed at the left edge of each extension block, encoded as a data URI.
 * @type {string}
 */
// eslint-disable-next-line max-len
const blockIconURI = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCA0MCI+PHN0eWxlPi5zdDJ7ZmlsbDpyZWR9LnN0M3tmaWxsOiNlMGUwZTB9LnN0NHtmaWxsOm5vbmU7c3Ryb2tlOiM2NjY7c3Ryb2tlLXdpZHRoOi41O3N0cm9rZS1taXRlcmxpbWl0OjEwfTwvc3R5bGU+PHBhdGggaWQ9IkxheWVyXzYiIGZpbGw9IiNmZmYiIGQ9Ik0zNSAyOEg1YTEgMSAwIDAgMS0xLTFWMTJjMC0uNi40LTEgMS0xaDMwYy41IDAgMSAuNCAxIDF2MTVjMCAuNS0uNSAxLTEgMSIvPjxnIGlkPSJMYXllcl80Ij48cGF0aCBkPSJNNCAyNWgzMnYyLjdINHptOS0xaC0yLjJhMSAxIDAgMCAxLTEtMXYtOS43YzAtLjYuNC0xIDEtMUgxM2MuNiAwIDEgLjQgMSAxVjIzYzAgLjYtLjUgMS0xIDEiIGNsYXNzPSJzdDIiLz48cGF0aCBkPSJNNi4xIDE5LjN2LTIuMmMwLS41LjQtMSAxLTFoOS43Yy41IDAgMSAuNSAxIDF2Mi4yYzAgLjUtLjUgMS0xIDFINy4xYTEgMSAwIDAgMS0xLTEiIGNsYXNzPSJzdDIiLz48Y2lyY2xlIGN4PSIyMi44IiBjeT0iMTguMiIgcj0iMy40IiBjbGFzcz0ic3QyIi8+PGNpcmNsZSBjeD0iMzAuNiIgY3k9IjE4LjIiIHI9IjMuNCIgY2xhc3M9InN0MiIvPjxwYXRoIGQ9Ik00LjIgMjdoMzEuOXYuN0g0LjJ6IiBjbGFzcz0ic3QyIi8+PC9nPjxnIGlkPSJMYXllcl81Ij48Y2lyY2xlIGN4PSIyMi44IiBjeT0iMTguMiIgcj0iMi4zIiBjbGFzcz0ic3QzIi8+PGNpcmNsZSBjeD0iMzAuNiIgY3k9IjE4LjIiIHI9IjIuMyIgY2xhc3M9InN0MyIvPjxwYXRoIGQ9Ik0xMi41IDIyLjloLTEuMmMtLjMgMC0uNS0uMi0uNS0uNVYxNGMwLS4zLjItLjUuNS0uNWgxLjJjLjMgMCAuNS4yLjUuNXY4LjRjMCAuMy0uMi41LS41LjUiIGNsYXNzPSJzdDMiLz48cGF0aCBkPSJNNy4yIDE4Ljd2LTEuMmMwLS4zLjItLjUuNS0uNWg4LjRjLjMgMCAuNS4yLjUuNXYxLjJjMCAuMy0uMi41LS41LjVINy43Yy0uMyAwLS41LS4yLS41LS41TTQgMjZoMzJ2Mkg0eiIgY2xhc3M9InN0MyIvPjwvZz48ZyBpZD0iTGF5ZXJfMyI+PHBhdGggZD0iTTM1LjIgMjcuOUg0LjhhMSAxIDAgMCAxLTEtMVYxMi4xYzAtLjYuNS0xIDEtMWgzMC41Yy41IDAgMSAuNCAxIDFWMjdhMSAxIDAgMCAxLTEuMS45eiIgY2xhc3M9InN0NCIvPjxwYXRoIGQ9Ik0zNS4yIDI3LjlINC44YTEgMSAwIDAgMS0xLTFWMTIuMWMwLS42LjUtMSAxLTFoMzAuNWMuNSAwIDEgLjQgMSAxVjI3YTEgMSAwIDAgMS0xLjEuOXoiIGNsYXNzPSJzdDQiLz48L2c+PC9zdmc+';

/**
 * Length of the buffer to store key presses for the "when keys pressed in order" hat
 * @type {number}
 */
const KEY_BUFFER_LENGTH = 100;

/**
 * Timeout in milliseconds to reset the completed flag for a sequence.
 * @type {number}
 */
const SEQUENCE_HAT_TIMEOUT = 100;

/**
 * An id for the space key on a keyboard.
 */
const KEY_ID_SPACE = 'SPACE';

/**
 * An id for the left arrow key on a keyboard.
 */
const KEY_ID_LEFT = 'LEFT';

/**
 * An id for the right arrow key on a keyboard.
 */
const KEY_ID_RIGHT = 'RIGHT';

/**
 * An id for the up arrow key on a keyboard.
 */
const KEY_ID_UP = 'UP';

/**
 * An id for the down arrow key on a keyboard.
 */
const KEY_ID_DOWN = 'DOWN';

/**
 * Names used by keyboard io for keys used in scratch.
 * @enum {string}
 */
const SCRATCH_KEY_NAME = {
    [KEY_ID_SPACE]: 'space',
    [KEY_ID_LEFT]: 'left arrow',
    [KEY_ID_UP]: 'up arrow',
    [KEY_ID_RIGHT]: 'right arrow',
    [KEY_ID_DOWN]: 'down arrow'
};

/**
 * Class for the makey makey blocks in Scratch 3.0
 * @constructor
 */
class Scratch3MakeyMakeyBlocks {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;

        /**
         * A toggle that alternates true and false each frame, so that an
         * edge-triggered hat can trigger on every other frame.
         * @type {boolean}
         */
        this.frameToggle = false;

        // Set an interval that toggles the frameToggle every frame.
        setInterval(() => {
            this.frameToggle = !this.frameToggle;
        }, this.runtime.currentStepTime);

        this.keyPressed = this.keyPressed.bind(this);
        this.runtime.on('KEY_PRESSED', this.keyPressed);

        this._clearkeyPressBuffer = this._clearkeyPressBuffer.bind(this);
        this.runtime.on('PROJECT_STOP_ALL', this._clearkeyPressBuffer);

        /*
         * An object containing a set of sequence objects.
         * These are the key sequences currently being detected by the "when
         * keys pressed in order" hat block. Each sequence is keyed by its
         * string representation (the sequence's value in the menu, which is a
         * string of KEY_IDs separated by spaces). Each sequence object
         * has an array property (an array of KEY_IDs) and a boolean
         * completed property that is true when the sequence has just been
         * pressed.
         * @type {object}
         */
        this.sequences = {};

        /*
         * An array of the key codes of recently pressed keys.
         * @type {array}
         */
        this.keyPressBuffer = [];
    }

    /*
    * Localized short-form names of the space bar and arrow keys, for use in the
    * displayed menu items of the "when keys pressed in order" block.
    * @type {object}
    */
    get KEY_TEXT_SHORT () {
        return {
            [KEY_ID_SPACE]: formatMessage({
                id: 'makeymakey.spaceKey',
                default: 'space',
                description: 'The space key on a computer keyboard.'
            }),
            [KEY_ID_LEFT]: formatMessage({
                id: 'makeymakey.leftArrowShort',
                default: 'left',
                description: 'Short name for the left arrow key on a computer keyboard.'
            }),
            [KEY_ID_UP]: formatMessage({
                id: 'makeymakey.upArrowShort',
                default: 'up',
                description: 'Short name for the up arrow key on a computer keyboard.'
            }),
            [KEY_ID_RIGHT]: formatMessage({
                id: 'makeymakey.rightArrowShort',
                default: 'right',
                description: 'Short name for the right arrow key on a computer keyboard.'
            }),
            [KEY_ID_DOWN]: formatMessage({
                id: 'makeymakey.downArrowShort',
                default: 'down',
                description: 'Short name for the down arrow key on a computer keyboard.'
            })
        };
    }

    /*
     * An array of strings of KEY_IDs representing the default set of
     * key sequences for use by the "when keys pressed in order" block.
     * @type {array}
     */
    get DEFAULT_SEQUENCES () {
        return [
            `${KEY_ID_LEFT} ${KEY_ID_UP} ${KEY_ID_RIGHT}`,
            `${KEY_ID_RIGHT} ${KEY_ID_UP} ${KEY_ID_LEFT}`,
            `${KEY_ID_LEFT} ${KEY_ID_RIGHT}`,
            `${KEY_ID_RIGHT} ${KEY_ID_LEFT}`,
            `${KEY_ID_UP} ${KEY_ID_DOWN}`,
            `${KEY_ID_DOWN} ${KEY_ID_UP}`,
            `${KEY_ID_UP} ${KEY_ID_RIGHT} ${KEY_ID_DOWN} ${KEY_ID_LEFT}`,
            `${KEY_ID_UP} ${KEY_ID_LEFT} ${KEY_ID_DOWN} ${KEY_ID_RIGHT}`,
            `${KEY_ID_UP} ${KEY_ID_UP} ${KEY_ID_DOWN} ${KEY_ID_DOWN} ` +
                `${KEY_ID_LEFT} ${KEY_ID_RIGHT} ${KEY_ID_LEFT} ${KEY_ID_RIGHT}`
        ];
    }

    /**
     * @returns {object} metadata for this extension and its blocks.
     */
    getInfo () {
        return {
            id: 'makeymakey',
            name: 'Makey Makey',
            blockIconURI: blockIconURI,
            blocks: [
                {
                    opcode: 'whenMakeyKeyPressed',
                    text: formatMessage({
                        id: 'makeymakey.whenKeyPressed',
                        default: 'when [KEY] key pressed',
                        description: 'when a keyboard key is pressed'
                    }),
                    blockType: BlockType.HAT,
                    arguments: {
                        KEY: {
                            type: ArgumentType.STRING,
                            menu: 'KEY',
                            defaultValue: KEY_ID_SPACE
                        }
                    }
                },
                {
                    opcode: 'whenCodePressed',
                    text: formatMessage({
                        id: 'makeymakey.whenKeysPressedInOrder',
                        default: 'when [SEQUENCE] pressed in order',
                        description: 'when a sequence of keyboard keys is pressed in a specific order'
                    }),
                    blockType: BlockType.HAT,
                    arguments: {
                        SEQUENCE: {
                            type: ArgumentType.STRING,
                            menu: 'SEQUENCE',
                            defaultValue: this.DEFAULT_SEQUENCES[0]
                        }
                    }
                }
            ],
            menus: {
                KEY: {
                    acceptReporters: true,
                    items: [
                        {
                            text: formatMessage({
                                id: 'makeymakey.spaceKey',
                                default: 'space',
                                description: 'The space key on a computer keyboard.'
                            }),
                            value: KEY_ID_SPACE
                        },
                        {
                            text: formatMessage({
                                id: 'makeymakey.upArrow',
                                default: 'up arrow',
                                description: 'The up arrow key on a computer keyboard.'
                            }),
                            value: KEY_ID_UP
                        },
                        {
                            text: formatMessage({
                                id: 'makeymakey.downArrow',
                                default: 'down arrow',
                                description: 'The down arrow key on a computer keyboard.'
                            }),
                            value: KEY_ID_DOWN
                        },
                        {
                            text: formatMessage({
                                id: 'makeymakey.rightArrow',
                                default: 'right arrow',
                                description: 'The right arrow key on a computer keyboard.'
                            }),
                            value: KEY_ID_RIGHT
                        },
                        {
                            text: formatMessage({
                                id: 'makeymakey.leftArrow',
                                default: 'left arrow',
                                description: 'The left arrow key on a computer keyboard.'
                            }),
                            value: KEY_ID_LEFT
                        },
                        {text: 'w', value: 'w'},
                        {text: 'a', value: 'a'},
                        {text: 's', value: 's'},
                        {text: 'd', value: 'd'},
                        {text: 'f', value: 'f'},
                        {text: 'g', value: 'g'}
                    ]
                },
                SEQUENCE: {
                    acceptReporters: true,
                    items: this.buildSequenceMenu(this.DEFAULT_SEQUENCES)
                }
            }
        };
    }

    /*
     * Build the menu of key sequences.
     * @param {array} sequencesArray an array of strings of KEY_IDs.
     * @returns {array} an array of objects with text and value properties.
     */
    buildSequenceMenu (sequencesArray) {
        return sequencesArray.map(
            str => this.getMenuItemForSequenceString(str)
        );
    }

    /*
     * Create a menu item for a sequence string.
     * @param {string} sequenceString a string of KEY_IDs.
     * @return {object} an object with text and value properties.
     */
    getMenuItemForSequenceString (sequenceString) {
        let sequenceArray = sequenceString.split(' ');
        sequenceArray = sequenceArray.map(str => this.KEY_TEXT_SHORT[str]);
        return {
            text: sequenceArray.join(' '),
            value: sequenceString
        };
    }

    /*
     * Check whether a keyboard key is currently pressed.
     * Also, toggle the results of the test on alternate frames, so that the
     * hat block fires repeatedly.
     * @param {object} args - the block arguments.
     * @property {number} KEY - a key code.
     * @param {object} util - utility object provided by the runtime.
     */
    whenMakeyKeyPressed (args, util) {
        let key = args.KEY;
        // Convert the key arg, if it is a KEY_ID, to the key name used by
        // the Keyboard io module.
        if (SCRATCH_KEY_NAME[args.KEY]) {
            key = SCRATCH_KEY_NAME[args.KEY];
        }
        const isDown = util.ioQuery('keyboard', 'getKeyIsDown', [key]);
        return (isDown && this.frameToggle);
    }

    /*
     * A function called on the KEY_PRESSED event, to update the key press
     * buffer and check if any of the key sequences have been completed.
     * @param {string} key A scratch key name.
     */
    keyPressed (key) {
        // Store only the first word of the Scratch key name, so that e.g. when
        // "left arrow" is pressed, we store "LEFT", which matches KEY_ID_LEFT
        key = key.split(' ')[0];
        key = key.toUpperCase();
        this.keyPressBuffer.push(key);
        // Keep the buffer under the length limit
        if (this.keyPressBuffer.length > KEY_BUFFER_LENGTH) {
            this.keyPressBuffer.shift();
        }
        // Check the buffer for each sequence in use
        for (const str in this.sequences) {
            const arr = this.sequences[str].array;
            // Bail out if we don't have enough presses for this sequence
            if (this.keyPressBuffer.length < arr.length) {
                continue;
            }
            let missFlag = false;
            // Slice the buffer to the length of the sequence we're checking
            const bufferSegment = this.keyPressBuffer.slice(-1 * arr.length);
            for (let i = 0; i < arr.length; i++) {
                if (arr[i] !== bufferSegment[i]) {
                    missFlag = true;
                }
            }
            // If the miss flag is false, the sequence matched the buffer
            if (!missFlag) {
                this.sequences[str].completed = true;
                // Clear the completed flag after a timeout. This is necessary because
                // the hat is edge-triggered (not event triggered). Multiple hats
                // may be checking the same sequence, so this timeout gives them enough
                // time to all trigger before resetting the flag.
                setTimeout(() => {
                    this.sequences[str].completed = false;
                }, SEQUENCE_HAT_TIMEOUT);
            }
        }
    }

    /**
     * Clear the key press buffer.
     */
    _clearkeyPressBuffer () {
        this.keyPressBuffer = [];
    }

    /*
     * Add a key sequence to the set currently being checked on each key press.
     * @param {string} sequenceString a string of space-separated KEY_IDs.
     * @param {array} sequenceArray an array of KEY_IDs.
     */
    addSequence (sequenceString, sequenceArray) {
        // If we already have this sequence string, return.
        if (Object.prototype.hasOwnProperty.call(this.sequences, sequenceString)) {
            return;
        }
        this.sequences[sequenceString] = {
            array: sequenceArray,
            completed: false
        };
    }

    /*
     * Check whether a key sequence was recently completed.
     * @param {object} args The block arguments.
     * @property {number} SEQUENCE A string of KEY_IDs.
     */
    whenCodePressed (args) {
        const sequenceString = Cast.toString(args.SEQUENCE).toUpperCase();
        const sequenceArray = sequenceString.split(' ');
        if (sequenceArray.length < 2) {
            return;
        }
        this.addSequence(sequenceString, sequenceArray);

        return this.sequences[sequenceString].completed;
    }
}
module.exports = Scratch3MakeyMakeyBlocks;
