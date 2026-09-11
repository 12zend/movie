export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform sampler2D u_map;
  uniform vec2 u_resolution;
  uniform float u_value;
  uniform int u_type;
  uniform int u_channel;
  uniform int u_invert;
  uniform float u_center;
  uniform float u_mix;

  vec4 sampleImage(vec2 uv) {
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
      return vec4(0.0);
    }
    return texture2D(u_image, uv);
  }

  void main() {
    // Scratch costume textures use the renderer's mirrored X texture space,
    // while the pen framebuffer uses screen-aligned UVs.
    vec4 mapPixel = texture2D(u_map, vec2(1.0 - v_uv.x, v_uv.y));
    vec3 straightMap = mapPixel.a > 0.00001 ? mapPixel.rgb / mapPixel.a : vec3(0.5);
    vec3 mapColor = mix(vec3(0.5), straightMap, mapPixel.a);
    float mapValue;
    if (u_channel == 1) mapValue = mapColor.r;
    else if (u_channel == 2) mapValue = mapColor.g;
    else if (u_channel == 3) mapValue = mapColor.b;
    else if (u_channel == 4) mapValue = mapPixel.a;
    else mapValue = dot(mapColor, vec3(0.2126, 0.7152, 0.0722));
    if (u_invert == 1) mapValue = 1.0 - mapValue;
    float amount = (mapValue - u_center) * 2.0 * u_value;
    vec2 displacedUv = v_uv;
    if (u_type == 0) {
      displacedUv.x -= amount / max(u_resolution.x, 1.0);
    } else if (u_type == 1) {
      displacedUv.y -= amount / max(u_resolution.y, 1.0);
    } else if (u_type == 2) {
      float invScale = 1.0 / max(0.01, 1.0 + amount / 100.0);
      displacedUv = vec2(0.5) + (v_uv - vec2(0.5)) * invScale;
    } else {
      float angle = radians(amount);
      float s = sin(angle);
      float c = cos(angle);
      displacedUv = vec2(0.5) + mat2(c, -s, s, c) * (v_uv - vec2(0.5));
    }
    vec4 displaced = sampleImage(displacedUv);
    float mixValue = clamp(u_mix, 0.0, 1.0);
    gl_FragColor = mixValue == 1.0 ? displaced : mix(texture2D(u_image, v_uv), displaced, mixValue);
  }
`;
