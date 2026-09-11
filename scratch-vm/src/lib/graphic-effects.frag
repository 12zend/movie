precision mediump float;

#ifdef DRAW_MODE_silhouette
uniform vec4 u_silhouetteColor;
#else
# ifdef ENABLE_color
uniform float u_color;
# endif
# ifdef ENABLE_brightness
uniform float u_brightness;
# endif
#endif

#ifdef DRAW_MODE_colorMask
uniform vec3 u_colorMask;
uniform float u_colorMaskTolerance;
#endif

#ifdef ENABLE_fisheye
uniform float u_fisheye;
#endif
#ifdef ENABLE_whirl
uniform float u_whirl;
#endif
#ifdef ENABLE_pixelate
uniform float u_pixelate;
#endif
#ifdef ENABLE_mosaic
uniform float u_mosaic;
#endif
#ifdef ENABLE_ghost
uniform float u_ghost;
#endif

#ifdef ENABLE_gaussianblur
uniform float u_gaussianBlur;
#endif
#ifdef ENABLE_lensblur
uniform float u_lensBlur;
#endif
#ifdef ENABLE_radialblur
uniform float u_radialBlur;
#endif
#ifdef ENABLE_directionalblur
uniform float u_directionalBlur;
#endif
#ifdef ENABLE_turbulentdisplace
uniform vec4 u_turbulentDisplace;
#endif
#ifdef ENABLE_posterize
uniform float u_posterize;
#endif
#ifdef ENABLE_rgbshift
uniform vec2 u_rgbShift;
uniform float u_rgbShiftColor;
#endif
#ifdef ENABLE_edgedetection
uniform float u_edgeDetection;
#endif
#ifdef ENABLE_circularripple
uniform vec3 u_circularRipple;
#endif
#ifdef ENABLE_pixelstretch
uniform vec4 u_pixelStretchA;
uniform vec4 u_pixelStretchB;
#endif
#ifdef ENABLE_bloom
uniform vec3 u_bloom;
#endif
#ifdef ENABLE_displacementmap
uniform sampler2D u_displacementMap;
uniform vec2 u_displacement;
#endif
#ifdef ENABLE_effectweight
uniform sampler2D u_effectWeight;
uniform float u_effectWeightAmount;
#endif

#ifdef DRAW_MODE_line
varying vec4 v_lineColor;
varying float v_lineThickness;
varying float v_lineLength;
#endif

#ifdef DRAW_MODE_background
uniform vec4 u_backgroundColor;
#endif

uniform sampler2D u_skin;
uniform vec2 u_skinSize;

#ifndef DRAW_MODE_background
varying vec2 v_texCoord;
#endif

const float epsilon = 1e-3;
const float pi = 3.14159265358979323846;
const vec2 kCenter = vec2(0.5, 0.5);

vec4 sampleSkin(vec2 coord) {
    if (any(lessThan(coord, vec2(0.0))) || any(greaterThan(coord, vec2(1.0)))) {
        return vec4(0.0);
    }
    return texture2D(u_skin, coord);
}

vec3 convertRGB2HSV(vec3 color) {
    vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(color.bg, k.wz), vec4(color.gb, k.xy), step(color.b, color.g));
    vec4 q = mix(vec4(p.xyw, color.r), vec4(color.r, p.yzx), step(p.x, color.r));
    float delta = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * delta + epsilon)), delta / (q.x + epsilon), q.x);
}

vec3 convertHSV2RGB(vec3 color) {
    vec3 p = abs(fract(color.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return color.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), color.y);
}

float random2d(vec2 value) {
    return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
}

float smoothNoise(vec2 value) {
    vec2 cell = floor(value);
    vec2 fraction = fract(value);
    fraction = fraction * fraction * (3.0 - 2.0 * fraction);
    float a = random2d(cell);
    float b = random2d(cell + vec2(1.0, 0.0));
    float c = random2d(cell + vec2(0.0, 1.0));
    float d = random2d(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
}

float fractalNoise(vec2 value, float complexity) {
    float result = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 5; octave++) {
        if (float(octave) < complexity) result += smoothNoise(value) * amplitude;
        value *= 2.03;
        amplitude *= 0.5;
    }
    return result;
}

vec4 gaussianBlur(vec2 coord, float radius) {
    vec2 stepSize = vec2(radius) / max(u_skinSize, vec2(1.0));
    vec4 color = vec4(0.0);
    float totalWeight = 0.0;
    for (int sampleIndex = 0; sampleIndex < 25; sampleIndex++) {
        float position = float(sampleIndex) / 24.0;
        float distanceFromCenter = sqrt(position);
        float angle = float(sampleIndex) * 2.39996323;
        vec2 offset = vec2(cos(angle), sin(angle)) * distanceFromCenter * stepSize;
        float weight = exp(-2.0 * position);
        color += sampleSkin(coord + offset) * weight;
        totalWeight += weight;
    }
    return color / totalWeight;
}

vec4 lensBlur(vec2 coord, float radius) {
    vec2 pixel = vec2(radius) / max(u_skinSize, vec2(1.0));
    vec4 color = sampleSkin(coord);
    for (int sampleIndex = 0; sampleIndex < 24; sampleIndex++) {
        float position = (float(sampleIndex) + 0.5) / 24.0;
        float distanceFromCenter = sqrt(position);
        float angle = float(sampleIndex) * 2.39996323;
        vec2 offset = vec2(cos(angle), sin(angle)) * distanceFromCenter * pixel;
        color += sampleSkin(coord + offset);
    }
    return color / 25.0;
}

vec4 radialBlur(vec2 coord, float amount) {
    vec2 direction = kCenter - coord;
    vec4 color = vec4(0.0);
    for (int sampleIndex = 0; sampleIndex < 24; sampleIndex++) {
        float position = float(sampleIndex) / 23.0;
        color += sampleSkin(coord + direction * amount * position * 0.35);
    }
    return color / 24.0;
}

vec4 directionalBlur(vec2 coord, float radius) {
    vec2 offset = vec2(radius, 0.0) / max(u_skinSize, vec2(1.0));
    vec4 color = vec4(0.0);
    for (int sampleIndex = 0; sampleIndex < 21; sampleIndex++) {
        float position = float(sampleIndex) / 20.0 * 2.0 - 1.0;
        color += sampleSkin(coord + offset * position);
    }
    return color / 21.0;
}

vec4 edgeColor(vec2 coord, float strength) {
    vec2 pixel = vec2(1.0) / max(u_skinSize, vec2(1.0));
    vec3 left = sampleSkin(coord - vec2(pixel.x, 0.0)).rgb;
    vec3 right = sampleSkin(coord + vec2(pixel.x, 0.0)).rgb;
    vec3 down = sampleSkin(coord - vec2(0.0, pixel.y)).rgb;
    vec3 up = sampleSkin(coord + vec2(0.0, pixel.y)).rgb;
    vec3 edge = sqrt((right - left) * (right - left) + (up - down) * (up - down));
    float alpha = sampleSkin(coord).a;
    return vec4(clamp(edge * strength * 3.0, 0.0, 1.0) * alpha, alpha);
}

vec3 brightSample(vec2 coord, float threshold) {
    vec4 sampleColor = sampleSkin(coord);
    vec3 straight = sampleColor.rgb / (sampleColor.a + epsilon);
    float brightness = max(max(straight.r, straight.g), straight.b);
    return straight * smoothstep(threshold, min(1.0, threshold + 0.1), brightness) * sampleColor.a;
}

vec3 bloomColor(vec2 coord, float threshold, float radius) {
    vec2 pixel = vec2(radius) / max(u_skinSize, vec2(1.0));
    vec3 color = vec3(0.0);
    float totalWeight = 0.0;
    for (int sampleIndex = 0; sampleIndex < 25; sampleIndex++) {
        float position = float(sampleIndex) / 24.0;
        float distanceFromCenter = sqrt(position);
        float angle = float(sampleIndex) * 2.39996323;
        vec2 offset = vec2(cos(angle), sin(angle)) * distanceFromCenter * pixel;
        float weight = exp(-2.0 * position);
        color += brightSample(coord + offset, threshold) * weight;
        totalWeight += weight;
    }
    return color / totalWeight;
}

void main() {
    #if !(defined(DRAW_MODE_line) || defined(DRAW_MODE_background))
    vec2 originalCoord = v_texCoord;
    vec2 texcoord0 = originalCoord;
    vec4 unaffectedColor = sampleSkin(originalCoord);

    #ifdef ENABLE_mosaic
    texcoord0 = fract(u_mosaic * texcoord0);
    #endif

    #ifdef ENABLE_pixelate
    vec2 pixelTexelSize = u_skinSize / u_pixelate;
    texcoord0 = (floor(texcoord0 * pixelTexelSize) + kCenter) / pixelTexelSize;
    #endif

    #ifdef ENABLE_whirl
    {
        vec2 offset = texcoord0 - kCenter;
        float magnitude = length(offset);
        float factor = max(1.0 - magnitude / 0.5, 0.0);
        float angle = u_whirl * factor * factor;
        mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        texcoord0 = rotation * offset + kCenter;
    }
    #endif

    #ifdef ENABLE_fisheye
    {
        vec2 vectorFromCenter = (texcoord0 - kCenter) / kCenter;
        float vectorLength = length(vectorFromCenter);
        float radius = pow(min(vectorLength, 1.0), u_fisheye) * max(1.0, vectorLength);
        texcoord0 = kCenter + radius * vectorFromCenter / max(vectorLength, epsilon) * kCenter;
    }
    #endif

    #ifdef ENABLE_turbulentdisplace
    {
        float noiseScale = max(u_turbulentDisplace.y, 1.0);
        vec2 noiseCoord = texcoord0 * u_skinSize / noiseScale;
        vec2 evolution = vec2(cos(u_turbulentDisplace.w), sin(u_turbulentDisplace.w)) * 4.0;
        float noiseX = fractalNoise(noiseCoord + evolution, u_turbulentDisplace.z) - 0.5;
        float noiseY = fractalNoise(noiseCoord + evolution + vec2(19.7, 7.3), u_turbulentDisplace.z) - 0.5;
        texcoord0 += vec2(noiseX, noiseY) * u_turbulentDisplace.x / max(u_skinSize, vec2(1.0));
    }
    #endif

    #ifdef ENABLE_circularripple
    {
        vec2 offset = texcoord0 - kCenter;
        float distanceFromCenter = length(offset);
        float wave = sin(distanceFromCenter * u_circularRipple.x * pi * 2.0 + u_circularRipple.z);
        vec2 ripple = offset / max(distanceFromCenter, epsilon) * wave * u_circularRipple.y;
        texcoord0 += ripple / max(u_skinSize, vec2(1.0));
    }
    #endif

    #ifdef ENABLE_pixelstretch
    {
        vec2 center = kCenter + u_pixelStretchB.xy * 0.5;
        float distanceFromCenter = length(texcoord0 - center);
        float radius = u_pixelStretchA.w * 0.5;
        float featherStart = radius * (1.0 - u_pixelStretchA.y);
        float influence = 1.0 - smoothstep(featherStart, radius, distanceFromCenter);
        influence = pow(max(influence, 0.0), max(0.05, u_pixelStretchA.z * 2.0));
        vec2 direction = vec2(cos(u_pixelStretchB.z), sin(u_pixelStretchB.z));
        texcoord0 -= direction * u_pixelStretchA.x * influence / max(u_skinSize, vec2(1.0));
    }
    #endif

    #ifdef ENABLE_displacementmap
    {
        vec4 mapColor = texture2D(u_displacementMap, originalCoord);
        float luminance = dot(mapColor.rgb / (mapColor.a + epsilon), vec3(0.299, 0.587, 0.114));
        float displacement = (luminance - 0.5) * mapColor.a;
        if (u_displacement.x < 0.5) {
            texcoord0.x += displacement * u_displacement.y / max(u_skinSize.x, 1.0);
        } else if (u_displacement.x < 1.5) {
            texcoord0.y += displacement * u_displacement.y / max(u_skinSize.y, 1.0);
        } else if (u_displacement.x < 2.5) {
            float scale = max(0.01, 1.0 + displacement * u_displacement.y / 100.0);
            texcoord0 = kCenter + (texcoord0 - kCenter) / scale;
        } else {
            float angle = displacement * u_displacement.y * pi / 180.0;
            vec2 offset = texcoord0 - kCenter;
            texcoord0 = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * offset + kCenter;
        }
    }
    #endif

    vec4 effectColor = sampleSkin(texcoord0);

    #ifdef ENABLE_gaussianblur
    effectColor = mix(effectColor, gaussianBlur(texcoord0, u_gaussianBlur), clamp(u_gaussianBlur / 6.0, 0.0, 1.0));
    #endif
    #ifdef ENABLE_lensblur
    effectColor = mix(effectColor, lensBlur(texcoord0, u_lensBlur), clamp(u_lensBlur / 6.0, 0.0, 1.0));
    #endif
    #ifdef ENABLE_radialblur
    effectColor = radialBlur(texcoord0, u_radialBlur);
    #endif
    #ifdef ENABLE_directionalblur
    effectColor = mix(
        effectColor,
        directionalBlur(texcoord0, u_directionalBlur),
        clamp(u_directionalBlur / 6.0, 0.0, 1.0)
    );
    #endif
    #ifdef ENABLE_edgedetection
    effectColor = mix(effectColor, edgeColor(texcoord0, u_edgeDetection), clamp(u_edgeDetection, 0.0, 1.0));
    #endif

    #ifdef ENABLE_rgbshift
    {
        vec2 direction = vec2(cos(u_rgbShift.y), sin(u_rgbShift.y));
        vec2 shift = direction * u_rgbShift.x / max(u_skinSize, vec2(1.0));
        vec4 positive = sampleSkin(texcoord0 + shift);
        vec4 negative = sampleSkin(texcoord0 - shift);
        if (u_rgbShiftColor < 0.5) {
            effectColor.r = positive.r;
            effectColor.g = negative.g;
        } else if (u_rgbShiftColor < 1.5) {
            effectColor.g = positive.g;
            effectColor.b = negative.b;
        } else {
            effectColor.b = positive.b;
            effectColor.r = negative.r;
        }
        effectColor.a = max(effectColor.a, max(positive.a, negative.a));
    }
    #endif

    #if defined(ENABLE_color) || defined(ENABLE_brightness) || defined(ENABLE_posterize)
    effectColor.rgb = clamp(effectColor.rgb / (effectColor.a + epsilon), 0.0, 1.0);
    #ifdef ENABLE_color
    {
        vec3 hsv = convertRGB2HSV(effectColor.rgb);
        const float minLightness = 0.055;
        const float minSaturation = 0.09;
        if (hsv.z < minLightness) hsv = vec3(0.0, 1.0, minLightness);
        else if (hsv.y < minSaturation) hsv = vec3(0.0, minSaturation, hsv.z);
        hsv.x = mod(hsv.x + u_color, 1.0);
        if (hsv.x < 0.0) hsv.x += 1.0;
        effectColor.rgb = convertHSV2RGB(hsv);
    }
    #endif
    #ifdef ENABLE_brightness
    effectColor.rgb = clamp(effectColor.rgb + vec3(u_brightness), 0.0, 1.0);
    #endif
    #ifdef ENABLE_posterize
    effectColor.rgb = floor(effectColor.rgb * (u_posterize - 1.0) + 0.5) / (u_posterize - 1.0);
    #endif
    effectColor.rgb *= effectColor.a + epsilon;
    #endif

    #ifdef ENABLE_bloom
    {
        vec3 bloom = bloomColor(texcoord0, u_bloom.x, u_bloom.y) * u_bloom.z;
        effectColor.rgb += bloom;
        effectColor.a = max(effectColor.a, clamp(max(max(bloom.r, bloom.g), bloom.b), 0.0, 1.0));
    }
    #endif

    #ifdef ENABLE_ghost
    effectColor *= u_ghost;
    #endif

    #ifdef ENABLE_effectweight
    {
        vec4 maskColor = texture2D(u_effectWeight, originalCoord);
        float maskLuminance = dot(maskColor.rgb / (maskColor.a + epsilon), vec3(0.299, 0.587, 0.114));
        float effectWeight = clamp(maskLuminance * maskColor.a * u_effectWeightAmount, 0.0, 1.0);
        effectColor = mix(unaffectedColor, effectColor, effectWeight);
    }
    #endif

    gl_FragColor = effectColor;

    #ifdef DRAW_MODE_silhouette
    if (gl_FragColor.a == 0.0) discard;
    gl_FragColor = u_silhouetteColor;
    #else
    #ifdef DRAW_MODE_colorMask
    vec3 maskDistance = abs(gl_FragColor.rgb - u_colorMask);
    vec3 tolerance = vec3(u_colorMaskTolerance);
    if (any(greaterThan(maskDistance, tolerance))) discard;
    #endif
    #endif

    #ifdef DRAW_MODE_straightAlpha
    gl_FragColor.rgb /= gl_FragColor.a + epsilon;
    #endif
    #endif

    #ifdef DRAW_MODE_line
    float d = ((v_texCoord.x - clamp(v_texCoord.x, 0.0, v_lineLength)) * 0.5) + 0.5;
    float line = distance(vec2(0.5), vec2(d, v_texCoord.y)) * 2.0;
    line -= ((v_lineThickness - 1.0) * 0.5);
    gl_FragColor = v_lineColor * clamp(1.0 - line, 0.0, 1.0);
    #endif

    #ifdef DRAW_MODE_background
    gl_FragColor = u_backgroundColor;
    #endif
}
