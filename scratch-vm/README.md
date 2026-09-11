## TurboWarp/scratch-vm

Modified Scratch VM with a JIT compiler and more features.

This is a drop-in replacement for LLK/scratch-vm.

## Setup

See https://github.com/TurboWarp/scratch-gui/wiki/Getting-Started to setup the complete TurboWarp environment.

If you just want to play with the VM then it's the same process as upstream scratch-vm.

## Extension authors

If you only use the standard reporter, boolean, and command block types, everything should just work without any changes.

## Compiler Overview

For a high-level overview of how the compiler works, see https://docs.turbowarp.org/how

For more technical information, read the code in src/compiler.

## Public API

This section was too out of date to be useful. We hope to re-add it as some point.

## License

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

This program is based on [scratchfoundation/scratch-vm](https://github.com/scratchfoundation/scratch-vm), which is under this license:

```
Copyright (c) 2016, Massachusetts Institute of Technology
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

<!--

## scratch-vm
#### Scratch VM is a library for representing, running, and maintaining the state of computer programs written using [Scratch Blocks](https://github.com/scratchfoundation/scratch-blocks).

[![CI/CD](https://github.com/scratchfoundation/scratch-vm/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/scratchfoundation/scratch-vm/actions/workflows/ci-cd.yml)

## Installation
This requires you to have Git and Node.js installed.

To install as a dependency for your own application:
```bash
npm install scratch-vm
```
To set up a development environment to edit scratch-vm yourself:
```bash
git clone https://github.com/scratchfoundation/scratch-vm.git
cd scratch-vm
npm install
```

## Development Server
This requires Node.js to be installed.

For convenience, we've included a development server with the VM. This is sometimes useful when running in an environment that's loading remote resources (e.g., SVGs from the Scratch server). If you would like to use your modified VM with the full Scratch 3.0 GUI, [follow the instructions to link the VM to the GUI](https://github.com/scratchfoundation/scratch-gui/wiki/Getting-Started).

## Running the Development Server
Open a Command Prompt or Terminal in the repository and run:
```bash
npm start
```

## Playground
To view the Playground, make sure the dev server's running and go to [http://localhost:8073/playground/](http://localhost:8073/playground/) - you will be directed to the playground, which demonstrates various tools and internal state.

![VM Playground Screenshot](https://i.imgur.com/nOCNqEc.gif)


## Standalone Build
```bash
npm run build
```

```html
<script src="/path/to/dist/web/scratch-vm.js"></script>
<script>
    var vm = new window.VirtualMachine();
    // do things
</script>
```

## How to include in a Node.js App
For an extended setup example, check out the /src/playground directory, which includes a fully running VM instance.
```js
var VirtualMachine = require('scratch-vm');
var vm = new VirtualMachine();

// Block events
Scratch.workspace.addChangeListener(vm.blockListener);

// Run threads
vm.start();
```

## Abstract Syntax Tree

#### Overview
The Virtual Machine constructs and maintains the state of an [Abstract Syntax Tree](https://en.wikipedia.org/wiki/Abstract_syntax_tree) (AST) by listening to events emitted by the [scratch-blocks](https://github.com/scratchfoundation/scratch-blocks) workspace via the `blockListener`. Each target (code-running object, for example, a sprite) keeps an AST for its blocks. At any time, the current state of an AST can be viewed by inspecting the `vm.runtime.targets[...].blocks` object.

#### Anatomy of a Block
The VM's block representation contains all the important information for execution and storage. Here's an example representing the "when key pressed" script on a workspace:
```json
{
  "_blocks": {
    "Q]PK~yJ@BTV8Y~FfISeo": {
      "id": "Q]PK~yJ@BTV8Y~FfISeo",
      "opcode": "event_whenkeypressed",
      "inputs": {
      },
      "fields": {
        "KEY_OPTION": {
          "name": "KEY_OPTION",
          "value": "space"
        }
      },
      "next": null,
      "topLevel": true,
      "parent": null,
      "shadow": false,
      "x": -69.333333333333,
      "y": 174
    }
  },
  "_scripts": [
    "Q]PK~yJ@BTV8Y~FfISeo"
  ]
}
```

## Testing
```bash
npm test
```

```bash
npm run coverage
```

## Publishing to GitHub Pages
```bash
npm run deploy
```

This will push the currently built playground to the gh-pages branch of the
currently tracked remote.  If you would like to change where to push to, add
a repo url argument:
```bash
npm run deploy -- -r <your repo url>
```

## Donate
We provide [Scratch](https://scratch.mit.edu) free of charge, and want to keep it that way! Please consider making a [donation](https://secure.donationpay.org/scratchfoundation/) to support our continued engineering, design, community, and resource development efforts. Donations of any size are appreciated. Thank you!

-->
