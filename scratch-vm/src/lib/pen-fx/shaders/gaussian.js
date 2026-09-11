export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform vec2 u_direction;
  uniform float u_radius;
  uniform int u_radialType;
  uniform int u_twoDimensional;
  uniform vec2 u_center;
  uniform float u_mix;

  float axisWeight(float index, vec4 weights) {
    float i = abs(index);
    return i < 0.5 ? weights.x : i < 1.5 ? weights.y : i < 2.5 ? weights.z : weights.w;
  }

  void main() {
    vec4 center = texture2D(u_image, v_uv);
    float mixValue = clamp(u_mix, 0.0, 1.0);
    if (u_radius <= 0.001) {
      gl_FragColor = center;
      return;
    }
    float sigma = max(u_radius * 0.38, 0.5);
    float invSigmaSq = 1.0 / (sigma * sigma);
    float negHalfInvSigmaSq = -0.5 * invSigmaSq;
    vec2 invResolution = 1.0 / u_resolution;
    if (u_twoDimensional == 2) {
      float gridStep = max(u_radius / 3.0, 0.125);
      vec4 axisWeights = exp(vec4(0.0, 1.0, 4.0, 9.0) * (negHalfInvSigmaSq * gridStep * gridStep));
      vec2 stepVec = u_direction * invResolution * gridStep;
      float lineWeight = axisWeights.x + 2.0 * (axisWeights.y + axisWeights.z + axisWeights.w);
      vec4 lineTotal = vec4(0.0);
      for (int i = -3; i <= 3; i++) {
        lineTotal += texture2D(u_image, v_uv + stepVec * float(i)) * axisWeight(float(i), axisWeights);
      }
      vec4 blurred = lineTotal / lineWeight;
      gl_FragColor = mixValue == 1.0 ? blurred : mix(center, blurred, mixValue);
      return;
    }
    if (u_twoDimensional == 1) {
      float gridStep = max(u_radius / 3.0, 0.125);
      vec4 axisWeights = exp(vec4(0.0, 1.0, 4.0, 9.0) * (negHalfInvSigmaSq * gridStep * gridStep));
      vec2 scaledStep = gridStep * invResolution;
      float axisSum = axisWeights.x + 2.0 * (axisWeights.y + axisWeights.z + axisWeights.w);
      float gridWeight = axisSum * axisSum;
      vec4 gridTotal = vec4(0.0);
      for (int y = -3; y <= 3; y++) {
        float wy = axisWeight(float(y), axisWeights);
        for (int x = -3; x <= 3; x++) {
          gridTotal += texture2D(u_image, v_uv + vec2(float(x), float(y)) * scaledStep) *
            (axisWeight(float(x), axisWeights) * wy);
        }
      }
      vec4 blurred = gridTotal / gridWeight;
      gl_FragColor = mixValue == 1.0 ? blurred : mix(center, blurred, mixValue);
      return;
    }
    vec2 direction = u_direction;
    if (u_radialType >= 0) {
      vec2 pixelFromCenter = v_uv * u_resolution - u_resolution * 0.5 - u_center;
      float distanceFromCenter = length(pixelFromCenter);
      vec2 radial = distanceFromCenter > 0.001 ? pixelFromCenter / distanceFromCenter : vec2(1.0, 0.0);
      direction = u_radialType == 0 ? vec2(-radial.y, radial.x) : radial;
    }
    direction *= invResolution;
    float stepSize = max(u_radius / 12.0, 0.125);
    vec2 stepDelta = direction * stepSize;
    vec4 total = center;
    float totalWeight = 1.0;
    for (int i = 1; i <= 12; i++) {
      float fi = float(i);
      float offset = fi * stepSize;
      float weight = exp(offset * offset * negHalfInvSigmaSq);
      vec2 delta = stepDelta * fi;
      total += (texture2D(u_image, v_uv - delta) +
                texture2D(u_image, v_uv + delta)) * weight;
      totalWeight += weight * 2.0;
    }
    vec4 blurred = total / totalWeight;
    gl_FragColor = mixValue == 1.0 ? blurred : mix(center, blurred, mixValue);
  }
`;
