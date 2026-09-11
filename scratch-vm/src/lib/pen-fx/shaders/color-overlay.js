export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec3 u_color;
  uniform float u_mix;

  vec3 straightColor(vec4 p) {
    return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
  }

  void main() {
    vec4 original = texture2D(u_image, v_uv);
    vec3 color = mix(straightColor(original), u_color, clamp(u_mix, 0.0, 1.0));
    gl_FragColor = vec4(clamp(color, 0.0, 1.0) * original.a, original.a);
  }
`;
