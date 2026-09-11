export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform sampler2D u_depth;
  uniform float u_cameraNear;
  uniform float u_cameraFar;
  uniform float u_flatDepth;
  uniform int u_mode;
  uniform float u_start;
  uniform float u_end;
  uniform float u_density;
  uniform float u_curve;
  uniform vec3 u_nearColor;
  uniform vec3 u_farColor;
  uniform float u_mix;

  const float rcpOneMinusExpNeg4 = 1.0186573604;

  float unpackDepth(vec3 encodedDepth) {
    if (all(greaterThan(encodedDepth, vec3(0.999)))) return 1.0;
    return dot(encodedDepth, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));
  }

  float viewDepth(vec2 uv) {
    if (u_flatDepth > 0.0) return u_flatDepth;
    float depth = unpackDepth(texture2D(u_depth, clamp(uv, 0.0, 1.0)).rgb);
    float z = depth * 2.0 - 1.0;
    return (2.0 * u_cameraNear * u_cameraFar) /
      max(z * (u_cameraNear - u_cameraFar) + (u_cameraFar + u_cameraNear), 0.00001);
  }

  void main() {
    vec4 original = texture2D(u_image, v_uv);
    if (original.a <= 0.00001 || u_density <= 0.0 || u_mix <= 0.0) {
      gl_FragColor = original;
      return;
    }

    float depth = viewDepth(v_uv);
    float span = u_end - u_start;
    float distanceFactor = abs(span) < 0.0001 ? step(u_start, depth) :
      clamp((depth - u_start) / span, 0.0, 1.0);
    float fogFactor = distanceFactor;
    if (u_mode == 1) {
      fogFactor = distanceFactor * distanceFactor * (3.0 - 2.0 * distanceFactor);
    } else if (u_mode == 2) {
      fogFactor = (1.0 - exp(-4.0 * distanceFactor)) * rcpOneMinusExpNeg4;
    } else if (u_mode == 3) {
      fogFactor = (1.0 - exp(-4.0 * distanceFactor * distanceFactor)) * rcpOneMinusExpNeg4;
    }
    fogFactor = pow(clamp(fogFactor, 0.0, 1.0), max(u_curve, 0.01));
    fogFactor *= clamp(u_density, 0.0, 1.0) * clamp(u_mix, 0.0, 1.0);

    vec3 originalColor = original.rgb * (1.0 / original.a);
    vec3 fogColor = mix(u_nearColor, u_farColor, distanceFactor);
    vec3 color = mix(originalColor, fogColor, fogFactor);
    gl_FragColor = vec4(clamp(color, 0.0, 1.0) * original.a, original.a);
  }
`;
