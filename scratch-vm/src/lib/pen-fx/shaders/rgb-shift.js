export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_direction;
  uniform float u_value;
  uniform float u_mix;
  uniform int u_pair;

  vec3 straightColor(vec4 p) {
    return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
  }

  void main() {
    float angle = radians(u_direction);
    vec2 delta = vec2(sin(angle), cos(angle)) * u_value / u_resolution;
    vec4 centerPixel = texture2D(u_image, v_uv);
    vec4 forwardPixel = texture2D(u_image, v_uv - delta);
    vec4 backwardPixel = texture2D(u_image, v_uv + delta);
    vec3 center = straightColor(centerPixel);
    vec3 forward = straightColor(forwardPixel);
    vec3 backward = straightColor(backwardPixel);
    vec3 c = center;
    if (u_pair == 0) {
      c.r = forward.r;
      c.g = backward.g;
    } else if (u_pair == 1) {
      c.g = forward.g;
      c.b = backward.b;
    } else {
      c.b = forward.b;
      c.r = backward.r;
    }
    float alpha = max(centerPixel.a, max(forwardPixel.a, backwardPixel.a));
    vec4 shiftedPixel = vec4(clamp(c, 0.0, 1.0) * alpha, alpha);
    gl_FragColor = mix(centerPixel, shiftedPixel, clamp(u_mix, 0.0, 1.0));
  }
`;
