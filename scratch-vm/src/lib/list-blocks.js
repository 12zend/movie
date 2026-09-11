import Cast from '../util/cast';
import compilerCompatBlocks from '../compiler/compat-blocks';

const OPCODE = 'data_changeitemoflistby';
const DATA_CATEGORY_PATCH = '__shadingChangeItemOfListByInstalled';

const changeItemOfListBy = (args, util) => {
    const list = util.target.lookupOrCreateList(
        args.LIST.id, args.LIST.name);
    const index = Cast.toListIndex(args.INDEX, list.value.length, false);
    if (index === Cast.LIST_INVALID) return;

    const currentValue = Cast.toNumber(list.value[index - 1]);
    const change = Cast.toNumber(
        Object.prototype.hasOwnProperty.call(args, 'VALUE') ? args.VALUE : args.ITEM
    );
    list.value[index - 1] = currentValue + change;
    list._monitorUpToDate = false;
};

const installBlockDefinition = ScratchBlocks => {
    if (!ScratchBlocks || !ScratchBlocks.Blocks) return;

    if (!ScratchBlocks.Blocks[OPCODE]) {
        ScratchBlocks.Blocks[OPCODE] = {
            init: function () {
                this.jsonInit({
                    message0: 'change item %1 of %2 by %3',
                    args0: [
                        {type: 'input_value', name: 'INDEX'},
                        {
                            type: 'field_variable',
                            name: 'LIST',
                            variableTypes: [ScratchBlocks.LIST_VARIABLE_TYPE]
                        },
                        {type: 'input_value', name: 'VALUE'}
                    ],
                    category: ScratchBlocks.Categories.dataLists,
                    extensions: ['colours_data_lists', 'shape_statement']
                });
            }
        };
    }

    const DataCategory = ScratchBlocks.DataCategory;
    if (!DataCategory || typeof DataCategory.addBlock !== 'function' ||
        typeof DataCategory.addReplaceItemOfList !== 'function' ||
        DataCategory[DATA_CATEGORY_PATCH]) return;

    DataCategory.addChangeItemOfListBy = function (xmlList, variable) {
        DataCategory.addBlock(
            xmlList,
            variable,
            OPCODE,
            'LIST',
            ['INDEX', 'math_integer', 1],
            ['VALUE', 'math_number', 1]
        );
    };

    const originalAddReplaceItemOfList = DataCategory.addReplaceItemOfList;
    DataCategory.addReplaceItemOfList = function (xmlList, variable) {
        originalAddReplaceItemOfList.call(this, xmlList, variable);
        DataCategory.addChangeItemOfListBy(xmlList, variable);
    };
    DataCategory[DATA_CATEGORY_PATCH] = true;
};

const installListBlocks = (vm, ScratchBlocks) => {
    if (vm && vm.runtime) {
        if (!vm.runtime._primitives) vm.runtime._primitives = {};
        vm.runtime._primitives[OPCODE] = changeItemOfListBy;

        if (!compilerCompatBlocks.stacked.includes(OPCODE)) {
            compilerCompatBlocks.stacked.push(OPCODE);
            compilerCompatBlocks.stacked.sort();
        }
    }

    installBlockDefinition(ScratchBlocks);
    return vm;
};

export {
    OPCODE,
    changeItemOfListBy,
    installBlockDefinition,
    installListBlocks
};

export default installListBlocks;
