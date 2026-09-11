export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_value;
  uniform float u_radius;
  uniform float u_mix;

  void main() {
    vec2 pixel = max(u_radius, 1.0) / u_resolution;
    vec2 dx = vec2(pixel.x, 0.0);
    vec2 dy = vec2(0.0, pixel.y);
    vec4 center = texture2D(u_image, v_uv);
    vec4 left = texture2D(u_image, v_uv - dx);
    vec4 right = texture2D(u_image, v_uv + dx);
    vec4 up = texture2D(u_image, v_uv + dy);
    vec4 down = texture2D(u_image, v_uv - dy);
    vec4 sharpened = center + max(u_value, 0.0) * (4.0 * center - left - right - up - down);
    float alpha = clamp(sharpened.a, 0.0, 1.0);
    vec4 result = vec4(clamp(sharpened.rgb, vec3(0.0), vec3(alpha)), alpha);
    gl_FragColor = mix(center, result, clamp(u_mix, 0.0, 1.0));
  }
`;
