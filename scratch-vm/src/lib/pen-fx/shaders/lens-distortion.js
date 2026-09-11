export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_value;
  uniform float u_zoom;
  uniform float u_mix;

  void main() {
    vec2 center = u_resolution * 0.5 + u_center;
    vec2 fromCenter = v_uv * u_resolution - center;
    float invRadiusScale = 1.0 / max(min(u_resolution.x, u_resolution.y) * 0.5, 1.0);
    float radiusSquared = dot(fromCenter, fromCenter) * invRadiusScale * invRadiusScale;
    float distortion = max(0.02, 1.0 + u_value * radiusSquared);
    float invZoom = 1.0 / max(u_zoom, 0.01);
    vec2 invResolution = 1.0 / u_resolution;
    vec2 uv = (center + fromCenter * (distortion * invZoom)) * invResolution;
    float mixValue = clamp(u_mix, 0.0, 1.0);
    vec4 basePixel = mixValue == 1.0 ? vec4(0.0) : texture2D(u_image, v_uv);
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
      gl_FragColor = mix(basePixel, vec4(0.0), mixValue);
    } else {
      gl_FragColor = mix(basePixel, texture2D(u_image, uv), mixValue);
    }
  }
`;
