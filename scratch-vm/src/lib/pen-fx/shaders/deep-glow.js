export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_threshold;
  uniform float u_radius;
  uniform float u_value;
  uniform vec3 u_color;

  void main() {
    vec4 base = texture2D(u_image, v_uv);
    vec3 baseColor = base.a > 0.00001 ? base.rgb / base.a : vec3(0.0);
    vec2 invResolution = 1.0 / u_resolution;
    float edgeLo = u_threshold - 0.02;
    float edgeHi = u_threshold + 0.02;
    vec3 lumWeights = vec3(0.2126, 0.7152, 0.0722);
    vec4 glow = vec4(0.0);
    for (int ring = 0; ring < 3; ring++) {
      float ringScale = exp2(float(ring));
      float sampleWeight = 1.0 / ringScale;
      vec2 ringDirScale = (u_radius * ringScale) * invResolution;
      float anglePhase = float(ring) * 0.37;
      for (int i = 0; i < 16; i++) {
        float angle = (float(i) + anglePhase) * 0.39269908169;
        vec4 p = texture2D(u_image, v_uv + vec2(cos(angle), sin(angle)) * ringDirScale);
        vec3 sampleColor = p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
        float lum = dot(sampleColor, lumWeights);
        glow += p * (smoothstep(edgeLo, edgeHi, lum) * sampleWeight);
      }
    }
    glow /= 28.0;
    float alpha = max(base.a, glow.a);
    vec3 glowColor = glow.a > 0.00001 ? glow.rgb / glow.a : vec3(0.0);
    vec3 color = baseColor + glowColor * u_color * glow.a * u_value * 2.25;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
  }
`;
