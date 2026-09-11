// AcerolaFX is written for ReShade/HLSL. This 2D adaptation keeps the color-buffer
// effects and their characteristic controls while remaining WebGL 1 friendly.
// All colors entering/leaving these passes are premultiplied for Scratch.
export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform int u_mode;
  uniform int u_type;
  uniform int u_type2;
  uniform float u_value;
  uniform float u_value2;
  uniform float u_value3;
  uniform float u_mix;
  uniform float u_time;
  uniform vec2 u_vec;
  uniform vec2 u_vec2;
  uniform vec3 u_color;
  uniform vec3 u_color2;
  uniform vec3 u_color3;
  uniform vec3 u_color4;

  vec3 straightColor(vec4 p) {
    return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
  }

  float luminance(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + u_time * 17.17) * 43758.5453123);
  }

  vec3 hueToRgb(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }

  vec3 rgbToHsl(vec3 c) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float d = mx - mn;
    float h = 0.0;
    if (d > 0.00001) {
      if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
      else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
      else h = (c.r - c.g) / d + 4.0;
      h /= 6.0;
    }
    float l = (mx + mn) * 0.5;
    float s = d / max(1.0 - abs(2.0 * l - 1.0), 0.00001);
    return vec3(h, s, l);
  }

  vec3 hslToRgb(vec3 hsl) {
    float chroma = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
    return (hueToRgb(hsl.x) - 0.5) * chroma + hsl.z;
  }

  float bayer4(vec2 pixel) {
    vec2 p = mod(floor(pixel), 4.0);
    vec2 r = mod(p, 2.0);
    vec2 q = (p - r) * 0.5;
    float hi = q.x * 2.0 + q.y * 3.0 - q.x * q.y * 4.0;
    float lo = r.x * 2.0 + r.y * 3.0 - r.x * r.y * 4.0;
    return (lo * 4.0 + hi) / 16.0 - 0.5;
  }

  vec3 toneMap(vec3 c, int kind, float whitePoint) {
    if (kind == 0) return clamp(c, 0.0, 1.0);
    if (kind == 1) {
      vec3 a = c * (c + 0.0245786) - 0.000090537;
      vec3 b = c * (0.983729 * c + 0.432951) + 0.238081;
      return clamp(a / b, 0.0, 1.0);
    }
    if (kind == 2) return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
    float l = max(luminance(c), 0.00001);
    return clamp(c * ((1.0 + l / max(whitePoint * whitePoint, 0.00001)) / (1.0 + l)), 0.0, 1.0);
  }

  float asciiGlyph(vec2 cell, float level) {
    vec2 p = abs(cell - 0.5);
    float dist = length(p);
    float dotShape = 1.0 - step(0.16, dist);
    float dashShape = (1.0 - step(0.38, p.x)) * (1.0 - step(0.09, p.y));
    float crossShape = max((1.0 - step(0.08, p.x)) * (1.0 - step(0.4, p.y)),
                           (1.0 - step(0.4, p.x)) * (1.0 - step(0.08, p.y)));
    float ringShape = (1.0 - step(0.42, dist)) * step(0.25, dist);
    if (level < 0.2) return 0.0;
    if (level < 0.4) return dotShape;
    if (level < 0.6) return dashShape;
    if (level < 0.8) return crossShape;
    return max(ringShape, crossShape);
  }

  void main() {
    vec4 p = texture2D(u_image, v_uv);
    vec3 original = straightColor(p);
    vec3 c = original;
    float alpha = p.a;

    if (u_mode == 0) {
      alpha = p.a * clamp(u_value, 0.0, 1.0);
    } else if (u_mode == 1) {
      float keyed = 1.0 - smoothstep(u_value, u_value + max(u_value2, 0.0001), distance(original, u_color));
      vec3 replacement = u_type == 1 ? mix(u_color2, u_color3, v_uv.x) : u_color2;
      if (u_type == 2) alpha *= 1.0 - keyed;
      else c = mix(original, replacement, keyed);
    } else if (u_mode == 2) {
      mat3 m;
      if (u_type == 0) m = mat3(0.625, 0.700, 0.000, 0.375, 0.300, 0.300, 0.000, 0.000, 0.700);
      else if (u_type == 1) m = mat3(0.567, 0.558, 0.000, 0.433, 0.442, 0.242, 0.000, 0.000, 0.758);
      else m = mat3(0.950, 0.000, 0.000, 0.050, 0.433, 0.475, 0.000, 0.567, 0.525);
      c = mix(original, clamp(m * original, 0.0, 1.0), clamp(u_value, 0.0, 1.0));
    } else if (u_mode == 3) {
      c *= exp2(u_value) * vec3(1.0 + u_value2 * 0.1,
                                1.0 - abs(u_value2) * 0.025 + u_value3 * 0.05,
                                1.0 - u_value2 * 0.1);
      c = (c - vec3(u_vec.x)) * u_vec.y + vec3(u_vec.x);
      c *= u_color;
      c = mix(vec3(luminance(c)), c, u_color2.x + 1.0);
    } else if (u_mode == 4) {
      float noise = bayer4((v_uv * u_resolution) / max(u_value3, 1.0));
      vec3 counts = max(vec3(u_vec, u_value), vec3(2.0));
      vec3 levels = counts - 1.0;
      c = clamp(original + noise * u_value2, 0.0, 1.0);
      c = floor(levels * c + 0.5) / levels;
    } else if (u_mode == 5) {
      float noise = hash(floor(v_uv * u_resolution / max(u_value3, 1.0))) * 2.0 - 1.0;
      float weight = mix(1.0, 1.0 - sqrt(clamp(luminance(original), 0.0, 1.0)), clamp(u_value2, 0.0, 1.0));
      c = original + original * noise * u_value * weight;
    } else if (u_mode == 6) {
      c = toneMap(max(original * exp2(u_value), vec3(0.0)), u_type, max(u_value2, 0.01));
    } else if (u_mode == 7) {
      vec2 pos = (v_uv - vec2(0.5) - u_vec2) * u_vec;
      vec2 d = pow(clamp(abs(pos) * u_value, 0.0, 1.0), vec2(max(u_value2, 0.01)));
      float factor = pow(clamp(1.0 - dot(d, d), 0.0, 1.0), max(u_value3, 0.01));
      c = mix(u_color, original, factor);
    } else if (u_mode == 8) {
      vec2 divisions = vec2(max(float(u_type), 1.0));
      vec2 cell = fract(v_uv * divisions);
      vec2 grid = min(cell, 1.0 - cell);
      float line = 1.0 - step(max(u_value / u_resolution.x, 0.0001), min(grid.x, grid.y));
      c = mix(original, u_color, line * clamp(u_value2, 0.0, 1.0));
    } else if (u_mode == 9) {
      float k = min(1.0 - original.r, min(1.0 - original.g, 1.0 - original.b));
      vec3 cmy = (vec3(1.0) - original - k) / max(1.0 - k, 0.0001);
      vec2 px = v_uv * u_resolution / max(u_value, 1.0);
      float cyan = step(sin(px.x * 0.75 + px.y * 0.2) * 0.5 + 0.5, cmy.r);
      float magenta = step(sin(px.x * -0.2 + px.y * 0.75) * 0.5 + 0.5, cmy.g);
      float yellow = step(sin(px.x * 0.72 + px.y * 0.72) * 0.5 + 0.5, cmy.b);
      float blackInk = step(sin(px.x * 0.72 - px.y * 0.72) * 0.5 + 0.5, k);
      c = clamp(vec3(1.0 - cyan, 1.0 - magenta, 1.0 - yellow) - blackInk, 0.0, 1.0);
    } else if (u_mode == 10) {
      vec2 q = v_uv * 2.0 - 1.0;
      vec2 t = q.yx / max(u_value, 1.0);
      vec2 warp = q + q * t * t;
      vec2 uv = warp * 0.5 + 0.5;
      vec4 warped = texture2D(u_image, uv);
      c = straightColor(warped);
      alpha = warped.a;
      vec2 border = smoothstep(vec2(0.0), vec2(max(u_value2, 0.001)), 1.0 - abs(warp));
      float scan = sin(v_uv.y * u_resolution.y * 3.14159265 / max(u_value3, 1.0));
      c *= border.x * border.y * (1.0 - u_vec.x + u_vec.x * (0.75 + 0.25 * scan));
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) alpha = 0.0;
    } else if (u_mode == 11) {
      float l = clamp(luminance(original), 0.0, 1.0);
      if (l < 0.333333) c = mix(u_color, u_color2, l * 3.0);
      else if (l < 0.666667) c = mix(u_color2, u_color3, (l - 0.333333) * 3.0);
      else c = mix(u_color3, u_color4, (l - 0.666667) * 3.0);
    } else if (u_mode == 12) {
      vec3 hsl = rgbToHsl(original);
      hsl.x = fract((hsl.x + u_value) * u_value2);
      hsl.y = clamp((hsl.y + u_vec.x) * u_vec.y, 0.0, 1.0);
      hsl.z = clamp((hsl.z + u_vec2.x) * u_vec2.y, 0.0, 1.0);
      c = hslToRgb(hsl);
    } else if (u_mode == 13) {
      vec2 cellSize = max(u_vec, vec2(2.0));
      vec2 gridPos = v_uv * u_resolution / cellSize;
      vec2 cell = fract(gridPos);
      vec2 centerUv = (floor(gridPos) + 0.5) * cellSize / u_resolution;
      vec3 sampleColor = straightColor(texture2D(u_image, centerUv));
      float level = luminance(sampleColor);
      if (u_type == 1) level = 1.0 - level;
      float glyph = asciiGlyph(cell, level);
      c = mix(u_color2, u_color * sampleColor, glyph);
    } else if (u_mode == 14) {
      vec2 pos = abs((v_uv - vec2(0.5) - u_vec2) * vec2(u_resolution.x / u_resolution.y, 1.0));
      float shape = u_type == 0 ? max(pos.x, pos.y) : length(pos);
      float frame = smoothstep(u_value, u_value + max(u_value2, 0.0001), shape);
      c = mix(original, u_color, frame * clamp(u_value3, 0.0, 1.0));
    } else {
      vec3 avg = vec3(0.0);
      avg += straightColor(texture2D(u_image, vec2(0.167, 0.167)));
      avg += straightColor(texture2D(u_image, vec2(0.500, 0.167)));
      avg += straightColor(texture2D(u_image, vec2(0.833, 0.167)));
      avg += straightColor(texture2D(u_image, vec2(0.167, 0.500)));
      avg += straightColor(texture2D(u_image, vec2(0.500, 0.500)));
      avg += straightColor(texture2D(u_image, vec2(0.833, 0.500)));
      avg += straightColor(texture2D(u_image, vec2(0.167, 0.833)));
      avg += straightColor(texture2D(u_image, vec2(0.500, 0.833)));
      avg += straightColor(texture2D(u_image, vec2(0.833, 0.833)));
      float averageLuminance = max(luminance(avg / 9.0), 0.001);
      float exposure = clamp(u_value / averageLuminance, u_value2, u_value3);
      c = original * exposure;
    }

    float mixAmount = clamp(u_mix, 0.0, 1.0);
    c = mix(original, clamp(c, 0.0, 1.0), mixAmount);
    alpha = mix(p.a, alpha, mixAmount);
    gl_FragColor = vec4(c * alpha, alpha);
  }
`;
