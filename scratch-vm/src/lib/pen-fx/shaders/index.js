import acerolaColor from './acerola-color';
import acerolaSpatial from './acerola-spatial';
import bloom from './bloom';
import color from './color';
import colorOverlay from './color-overlay';
import copy from './copy';
import deepGlow from './deep-glow';
import depthOfField from './depth-of-field';
import displacement from './displacement';
import fog from './fog';
import fractalNoise from './fractal-noise';
import gaussian from './gaussian';
import geometry from './geometry';
import gradationOverlay from './gradation-overlay';
import lensBlur from './lens-blur';
import lensDistortion from './lens-distortion';
import pixelStretch from './pixel-stretch';
import rgbShift from './rgb-shift';
import sharpen from './sharpen';
import signal from './signal';
import stroke from './stroke';
import vertex from './vertex';
import wavy from './wavy';
import {composite, groupOver, matteOver, stack} from './common';

const programSources = {
    copy,
    color,
    colorOverlay,
    stroke,
    gradationOverlay,
    rgbShift,
    signal,
    gaussian,
    bloom,
    wavy,
    fractalNoise,
    lensBlur,
    depthOfField,
    fog,
    lensDistortion,
    pixelStretch,
    sharpen,
    deepGlow,
    geometry,
    displacement,
    acerolaColor,
    acerolaSpatial,
    composite,
    groupOver,
    matteOver,
    stack
};

export {programSources, vertex};
