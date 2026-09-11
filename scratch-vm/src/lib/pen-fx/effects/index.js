import acerolaColor from './acerola-color';
import acerolaSpatial from './acerola-spatial';
import blob from './blob';
import bloom from './bloom';
import color from './color';
import colorOverlay from './color-overlay';
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
import pixelSort from './pixel-sort';
import pixelStretch from './pixel-stretch';
import rgbShift from './rgb-shift';
import sharpen from './sharpen';
import signal from './signal';
import stack from './stack';
import stroke from './stroke';
import wavy from './wavy';

const effectInstallers = [
    color,
    colorOverlay,
    gradationOverlay,
    stroke,
    blob,
    rgbShift,
    signal,
    gaussian,
    lensBlur,
    depthOfField,
    fog,
    lensDistortion,
    pixelStretch,
    sharpen,
    bloom,
    deepGlow,
    geometry,
    wavy,
    fractalNoise,
    acerolaColor,
    acerolaSpatial,
    pixelSort,
    displacement,
    stack
];

const installEffects = context => {
    effectInstallers.forEach(install => install(context));
};

export default installEffects;
