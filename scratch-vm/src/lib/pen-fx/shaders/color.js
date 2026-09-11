export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform int u_mode;
  uniform float u_value;
  uniform float u_mix;
  uniform float u_pivot;
  uniform vec3 u_color;
  uniform vec3 u_add;
  uniform vec3 u_mul;
  uniform vec3 u_div;

  vec3 straightColor(vec4 p) {
    return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
  }

  void main() {
    vec4 p = texture2D(u_image, v_uv);
    vec3 original = straightColor(p);
    vec3 c = original;
    if (u_mode == 0) {
      c = vec3(u_pivot) + (c - vec3(u_pivot)) * u_value;
    } else if (u_mode == 1) {
      c += u_color * u_value;
    } else if (u_mode == 2) {
      c = pow(max(c, vec3(0.0)), vec3(max(u_value, 0.00001)));
    } else if (u_mode == 3) {
      float luminance = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luminance), c, u_value);
    } else {
      c = ((c / max(u_div, vec3(0.0039215686))) * u_mul) + u_add;
    }
    c = mix(original, c, clamp(u_mix, 0.0, 1.0));
    gl_FragColor = vec4(clamp(c, 0.0, 1.0) * p.a, p.a);
  }
`;
