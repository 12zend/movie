export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_radius;
  uniform float u_blades;
  uniform float u_rotation;
  uniform float u_mix;

  void main() {
    if (u_radius <= 0.001) {
      gl_FragColor = texture2D(u_image, v_uv);
      return;
    }
    vec4 original = texture2D(u_image, v_uv);
    vec4 total = original * 1.5;
    float totalWeight = 1.5;
    vec2 invResolution = vec2(1.0) / u_resolution;
    float rotationRad = radians(u_rotation);
    bool polygonal = u_blades >= 3.0;
    float bladesSafe = max(u_blades, 3.0);
    float sector = 6.28318530718 / bladesSafe;
    float halfSector = sector * 0.5;
    float polyCos = cos(3.14159265359 / bladesSafe);
    for (int i = 0; i < 32; i++) {
      float fi = float(i) + 0.5;
      float angle = fi * 2.39996322973;
      float shape = 1.0;
      if (polygonal) {
        float localAngle = mod(angle - rotationRad + halfSector, sector) - halfSector;
        shape = polyCos / max(cos(localAngle), 0.001);
      }
      float normRadius = sqrt(fi * 0.03125) * shape;
      float radius = normRadius * u_radius;
      float weight = 1.0 + normRadius * 0.35;
      total += texture2D(u_image, v_uv + vec2(cos(angle), sin(angle)) * (radius * invResolution)) * weight;
      totalWeight += weight;
    }
    gl_FragColor = mix(original, total * (1.0 / totalWeight), clamp(u_mix, 0.0, 1.0));
  }
`;
