export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform float u_direction;
  uniform float u_mix;
  uniform int u_stopCount;
  uniform vec3 u_color0;
  uniform vec3 u_color1;
  uniform vec3 u_color2;
  uniform vec3 u_color3;
  uniform vec3 u_color4;
  uniform vec3 u_color5;
  uniform vec3 u_color6;
  uniform vec3 u_color7;
  uniform float u_position0;
  uniform float u_position1;
  uniform float u_position2;
  uniform float u_position3;
  uniform float u_position4;
  uniform float u_position5;
  uniform float u_position6;
  uniform float u_position7;

  vec3 straightColor(vec4 p) {
    return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
  }

  vec3 gradientColor(float position) {
    if (u_stopCount <= 1 || position <= u_position0) return u_color0;
    if (u_stopCount <= 2 || position <= u_position1) {
      return mix(u_color0, u_color1, smoothstep(u_position0, u_position1, position));
    }
    if (u_stopCount <= 3 || position <= u_position2) {
      return mix(u_color1, u_color2, smoothstep(u_position1, u_position2, position));
    }
    if (u_stopCount <= 4 || position <= u_position3) {
      return mix(u_color2, u_color3, smoothstep(u_position2, u_position3, position));
    }
    if (u_stopCount <= 5 || position <= u_position4) {
      return mix(u_color3, u_color4, smoothstep(u_position3, u_position4, position));
    }
    if (u_stopCount <= 6 || position <= u_position5) {
      return mix(u_color4, u_color5, smoothstep(u_position4, u_position5, position));
    }
    if (u_stopCount <= 7 || position <= u_position6) {
      return mix(u_color5, u_color6, smoothstep(u_position5, u_position6, position));
    }
    if (position <= u_position7) {
      return mix(u_color6, u_color7, smoothstep(u_position6, u_position7, position));
    }
    return u_color7;
  }

  void main() {
    vec4 original = texture2D(u_image, v_uv);
    vec2 direction = vec2(sin(radians(u_direction)), cos(radians(u_direction)));
    float position = clamp(dot(v_uv - vec2(0.5), direction) + 0.5, 0.0, 1.0);
    vec3 color = mix(straightColor(original), gradientColor(position), clamp(u_mix, 0.0, 1.0));
    gl_FragColor = vec4(clamp(color, 0.0, 1.0) * original.a, original.a);
  }
`;
