export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform int u_mode;
  uniform float u_tracking;
  uniform float u_chroma;
  uniform float u_noise;
  uniform float u_scanlines;
  uniform float u_evolution;
  uniform float u_seed;
  uniform float u_slices;
  uniform float u_shift;
  uniform float u_rgb;
  uniform float u_density;
  uniform float u_mix;

  vec4 sampleImage(vec2 uv) {
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
      return vec4(0.0);
    }
    return texture2D(u_image, uv);
  }

  float hash(vec2 value) {
    value += vec2(u_seed * 0.127, u_seed * 0.311);
    return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec4 original = texture2D(u_image, v_uv);
    vec2 pixel = v_uv * u_resolution;
    vec2 uv = v_uv;
    float frame = mod(u_evolution, 100000.0);
    float invSafeWidth = 1.0 / max(u_resolution.x, 1.0);
    float alpha;
    vec3 color;

    if (u_mode == 0) {
      float line = floor(pixel.y * 0.25);
      float lineNoise = hash(vec2(line, frame * 0.071)) * 2.0 - 1.0;
      float wobble = sin(pixel.y * 0.045 + frame * 0.83) * 0.45;
      float trackingCenter = mix(0.12, 0.88, hash(vec2(floor(frame * 0.19), 41.0)));
      float bandT = (v_uv.y - trackingCenter) / 0.035;
      float trackingBand = exp(-bandT * bandT);
      float trackingNoise = hash(vec2(floor(pixel.y), floor(frame * 2.0))) * 2.0 - 1.0;
      float horizontalShift = (lineNoise * 0.28 + wobble + trackingNoise * trackingBand * 1.8) * u_tracking;
      uv.x += horizontalShift * invSafeWidth;

      float chromaWave = 0.65 + 0.35 * sin(pixel.y * 0.021 + frame * 0.37);
      vec2 chromaOffset = vec2(u_chroma * chromaWave * invSafeWidth, 0.0);
      vec4 redPixel = sampleImage(uv + chromaOffset);
      vec4 greenPixel = sampleImage(uv);
      vec4 bluePixel = sampleImage(uv - chromaOffset);
      alpha = max(redPixel.a, max(greenPixel.a, bluePixel.a));
      color = vec3(
        redPixel.a > 0.00001 ? redPixel.r / redPixel.a : 0.0,
        greenPixel.a > 0.00001 ? greenPixel.g / greenPixel.a : 0.0,
        bluePixel.a > 0.00001 ? bluePixel.b / bluePixel.a : 0.0
      );

      float tapeNoise = hash(floor(pixel * vec2(0.5, 1.0)) + vec2(frame * 13.7, frame * 5.3)) * 2.0 - 1.0;
      float streakNoise = hash(vec2(floor(pixel.y * 0.5), floor(frame * 3.0))) * 2.0 - 1.0;
      color += (tapeNoise * 0.72 + streakNoise * 0.28) * u_noise;
      float scanline = 0.5 + 0.5 * sin(pixel.y * 3.14159265359);
      color *= 1.0 - u_scanlines * (0.35 + 0.65 * scanline);
      color = mix(color, vec3(dot(color, vec3(0.299, 0.587, 0.114))), 0.08);
      color += vec3(trackingBand * u_noise * (0.25 + 0.75 * hash(vec2(pixel.x, frame))));
    } else {
      float slices = max(u_slices, 1.0);
      float slice = floor(v_uv.y * slices);
      float sliceRandom = hash(vec2(slice, floor(frame)));
      float activeMask = step(1.0 - u_density, sliceRandom);
      float blockWidth = max(8.0, u_resolution.x / 12.0);
      float block = floor(pixel.x * (1.0 / blockWidth));
      float blockRandom = hash(vec2(block + slice * 17.0, floor(frame * 1.7)));
      float blockGate = mix(0.45, 1.0, step(0.38, blockRandom));
      float sliceShift = (hash(vec2(slice * 3.1, frame * 0.53)) * 2.0 - 1.0) * u_shift * activeMask * blockGate;
      uv.x += sliceShift * invSafeWidth;

      float splitPulse = activeMask * (0.45 + 0.55 * blockRandom);
      vec2 rgbOffset = vec2(u_rgb * splitPulse * invSafeWidth, 0.0);
      vec4 redPixel = sampleImage(uv + rgbOffset);
      vec4 greenPixel = sampleImage(uv);
      vec4 bluePixel = sampleImage(uv - rgbOffset);
      alpha = max(redPixel.a, max(greenPixel.a, bluePixel.a));
      color = vec3(
        redPixel.a > 0.00001 ? redPixel.r / redPixel.a : 0.0,
        greenPixel.a > 0.00001 ? greenPixel.g / greenPixel.a : 0.0,
        bluePixel.a > 0.00001 ? bluePixel.b / bluePixel.a : 0.0
      );

      float dropoutRandom = hash(vec2(block * 7.3 + slice, floor(frame * 2.3)));
      float dropout = activeMask * step(0.91, dropoutRandom);
      vec3 dropoutColor = vec3(hash(vec2(slice, frame)), 0.08, hash(vec2(block, frame + 9.0))) * 0.35;
      color = mix(color, dropoutColor, dropout);
      float digitalNoise = hash(floor(pixel) + vec2(frame * 19.0, frame * 23.0)) - 0.5;
      color += digitalNoise * activeMask * u_density * 0.16;
    }

    vec4 effected = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
    gl_FragColor = mix(original, effected, clamp(u_mix, 0.0, 1.0));
  }
`;
