/* eslint-disable */

import detectMovieBlobs, {drawMovieBlobOverlay} from '../../movie-blob-detection';
import {boolean, color, number, numberOr} from '../helpers';

const BLOB_MODES = ['alpha', 'bright', 'color', 'dark', 'motion'];

const install = ({Engine, PenFX}) => {
    Engine.prototype.blob = function (options, blendMode) {
        const gl = this.gl;
        if (this.blendOpacity <= 0) return;
        const skin = this._prepare();
        if (!skin) return;
        const width = this.width;
        const height = this.height;
        const pixelLength = width * height * 4;
        if (!this.blobSource || this.blobSource.length !== pixelLength) {
            this.blobSource = new Uint8Array(pixelLength);
        }
        const source = this.blobSource;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[0]);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, source);
        const frame = {data: source, height, width};
        // detectMovieBlobs never mutates its inputs, so the baseline buffer can be
        // refilled in place once detection finishes instead of copying every frame.
        const previousBlobFrame = this.previousBlobFrame;
        const staleBaseline = !previousBlobFrame || !previousBlobFrame.data ||
            previousBlobFrame.data.length !== pixelLength;
        const boxes = detectMovieBlobs(frame, options, staleBaseline ? null : previousBlobFrame);
        this._storeBlobBaseline(source);
        if (!boxes.length) return;
        if (!this.blobOutput || this.blobOutput.length !== pixelLength) {
            this.blobOutput = new Uint8Array(pixelLength);
        }
        const output = drawMovieBlobOverlay(frame, boxes, options, this.blobOutput);
        const direct = this._canRenderDirectly(blendMode);
        if (!direct) this._ensureSecondaryBuffer();
        gl.bindTexture(gl.TEXTURE_2D, direct ? skin._texture : this.textures[1]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, output);
        if (direct) this._markSkinChanged(skin);
        else this._finish(skin, this.textures[1], blendMode);
    };

    Engine.prototype._storeBlobBaseline = function (source) {
        const previousBlobFrame = this.previousBlobFrame;
        if (!previousBlobFrame || previousBlobFrame.data.length !== source.length) {
            this.previousBlobFrame = {
                data: new Uint8Array(source),
                height: this.height,
                width: this.width
            };
            return;
        }
        previousBlobFrame.data.set(source);
        previousBlobFrame.height = this.height;
        previousBlobFrame.width = this.width;
    };

    PenFX.prototype.blob = function (args) {
        const modeArg = String(args.MODE);
        const mode = BLOB_MODES.includes(modeArg) ? modeArg : 'dark';
        const shape = String(args.SHAPE) === 'ellipse' ? 'ellipse' : 'rectangle';
        this._safe(engine => engine.blob({
            blurRadius: Math.max(0, number(args.BLUR)),
            color: color(args.COLOR || '#00ffff'),
            fillOpacity: Math.min(1, Math.max(0, number(args.FILL) / 100)),
            marker: boolean(args.MARKER),
            maximumSize: Math.min(100, Math.max(0, numberOr(args.MAX, 100))),
            minimumSize: Math.min(100, Math.max(0, number(args.MIN))),
            mode,
            shape,
            strokeOpacity: Math.min(1, Math.max(0, numberOr(args.OPACITY, 100) / 100)),
            strokeWidth: Math.max(1, numberOr(args.WIDTH, 2)),
            targetColor: color(args.KEY || '#ffffff'),
            threshold: Math.min(255, Math.max(0, numberOr(args.THRESHOLD, 50)))
        }, this.blendMode));
    };
};

export default install;
