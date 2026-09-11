export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform int u_fractalType;
  uniform int u_noiseType;
  uniform int u_invert;
  uniform float u_contrast;
  uniform float u_brightness;
  uniform int u_overflow;
  uniform float u_rotation;
  uniform float u_scale;
  uniform vec2 u_scaleDimensions;
  uniform vec2 u_offset;
  uniform int u_perspective;
  uniform float u_depth;
  uniform float u_evolution;
  uniform int u_cycleEvolution;
  uniform float u_cycle;

  float hash(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
  }

  vec2 interpolation(vec2 f) {
    if (u_noiseType == 0) return vec2(0.0);
    if (u_noiseType == 1) return f;
    if (u_noiseType == 2) return f * f * (3.0 - 2.0 * f);
    return f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  }

  float valueNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = interpolation(fract(p));
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  vec2 rotate2D(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat2(c, -s, s, c) * p;
  }

  float fractal(vec2 p) {
    if (u_fractalType == 13) p *= 2.75;
    if (u_fractalType == 14) p *= 1.8;
    if (u_fractalType == 15) p = vec2(p.x * 0.22, p.y * 2.4);
    if (u_fractalType == 16) p = vec2(p.x * 0.1, p.y * 4.2);

    float sum = 0.0;
    float total = 0.0;
    float maximum = 0.0;
    float amplitude = u_fractalType == 11 ? 0.62 : 0.5;
    float ampDecay = u_fractalType == 11 ? 0.62 : 0.5;
    float lacunarity = u_fractalType == 11 ? 1.78 : u_fractalType == 13 ? 2.65 : 2.03;
    float depthClamped = clamp(u_depth, 1.0, 10.0);
    float previous = 0.0;
    for (int i = 0; i < 10; i++) {
      float fi = float(i);
      float octaveMask = step(fi + 0.5, depthClamped);
      vec2 samplePoint = p;
      if (u_fractalType == 4) {
        samplePoint += vec2(previous, valueNoise(p + vec2(9.7, 3.1)) - 0.5) * 1.4;
      } else if (u_fractalType == 5) {
        samplePoint = rotate2D(p, previous * 0.9 + fi * 0.13);
      } else if (u_fractalType == 6) {
        float twist = (length(p) + previous * 2.0) * 0.32;
        samplePoint = rotate2D(p, twist);
      } else if (u_fractalType == 8) {
        samplePoint.x += previous * 3.2;
      } else if (u_fractalType == 9) {
        samplePoint = rotate2D(p, previous * 1.8);
      }

      float n = valueNoise(samplePoint) * 2.0 - 1.0;
      float contribution = n;
      if (u_fractalType == 1) {
        contribution = 1.0 - abs(n);
        contribution = contribution * contribution;
      } else if (u_fractalType == 2) {
        contribution = abs(n);
      } else if (u_fractalType == 3) {
        contribution = pow(abs(n), 0.32);
      } else if (u_fractalType == 7) {
        maximum = max(maximum, (n * 0.5 + 0.5) * (0.72 + amplitude) * octaveMask);
      } else if (u_fractalType == 10) {
        contribution = 1.0 - abs(n);
        contribution *= contribution;
        contribution = contribution * 2.0 - 1.0;
      } else if (u_fractalType == 12) {
        contribution = floor((n * 0.5 + 0.5) * 7.0) / 3.0 - 1.0;
      } else if (u_fractalType == 14) {
        contribution = 1.0 - abs(n);
        contribution = pow(contribution, 4.0) * 2.0 - 1.0;
      } else if (u_fractalType == 15) {
        contribution = pow(1.0 - abs(n), 3.0) * 2.0 - 1.0;
      } else if (u_fractalType == 16) {
        contribution = pow(1.0 - abs(n), 7.0) * 2.0 - 1.0;
      }

      sum += contribution * amplitude * octaveMask;
      total += amplitude * octaveMask;
      previous = n;
      vec2 warped = p * lacunarity + vec2(17.13, 9.27);
      p = vec2(
        warped.x * 0.9855847669 + warped.y * 0.1691823491,
        warped.y * 0.9855847669 - warped.x * 0.1691823491
      );
      amplitude *= ampDecay;
    }

    if (u_fractalType == 7) return maximum;
    float result = sum / max(total, 0.0001) * 0.5 + 0.5;
    if (u_fractalType == 8) result = mix(result, smoothstep(0.18, 0.82, result), 0.7);
    if (u_fractalType == 9) result = smoothstep(0.08, 0.92, result);
    if (u_fractalType == 11) result = smoothstep(0.12, 0.88, result);
    if (u_fractalType == 12) result += (valueNoise(p * 3.7) - 0.5) * 0.16;
    return result;
  }

  void main() {
    vec4 original = texture2D(u_image, v_uv);
    if (original.a <= 0.00001) {
      gl_FragColor = vec4(0.0);
      return;
    }

    vec2 centered = v_uv * u_resolution - u_resolution * 0.5;
    if (u_perspective == 1) {
      float perspective = max(0.3, 1.0 + centered.y / max(u_resolution.y, 1.0) * 0.85);
      centered *= 1.0 / perspective;
    }
    centered = rotate2D(centered, radians(u_rotation));
    centered += u_offset;
    vec2 dimensions = max(abs(u_scaleDimensions), vec2(0.01)) * 0.01;
    vec2 scale = max(abs(u_scale) * dimensions, vec2(0.01));
    vec2 p = centered / scale;

    float evolution = u_evolution / 360.0;
    if (u_cycleEvolution == 1) {
      float cycle = max(abs(u_cycle), 0.0001);
      float phase = fract(evolution / cycle) * 6.28318530718;
      p += vec2(cos(phase), sin(phase)) * 4.0;
    } else {
      p += vec2(evolution * 0.73, evolution * 0.41);
    }

    float value = fractal(p);
    if (u_invert == 1) value = 1.0 - value;
    value = (value - 0.5) * (u_contrast * 0.01) + 0.5 + u_brightness * 0.01;
    if (u_overflow == 1) {
      value = clamp(value, 0.0, 1.0);
    } else if (u_overflow == 2) {
      float centeredValue = value - 0.5;
      value = 0.5 + centeredValue / (1.0 + 2.0 * abs(centeredValue));
    }
    gl_FragColor = vec4(vec3(value) * original.a, original.a);
  }
`;
