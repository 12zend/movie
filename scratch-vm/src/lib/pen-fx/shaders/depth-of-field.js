export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform sampler2D u_depth;
  uniform vec2 u_resolution;
  uniform float u_cameraNear;
  uniform float u_cameraFar;
  uniform float u_flatDepth;
  uniform float u_focusDistance;
  uniform float u_focusRange;
  uniform float u_aperture;
  uniform float u_maxBlur;
  uniform float u_nearStrength;
  uniform float u_farStrength;
  uniform float u_edgeSoftness;
  uniform float u_blades;
  uniform float u_rotation;
  uniform float u_mix;

  float unpackDepth(vec3 encodedDepth) {
    if (all(greaterThan(encodedDepth, vec3(0.999)))) return 1.0;
    return dot(encodedDepth, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));
  }

  float viewDepth(vec2 uv, float nearMulFar, float nearSum, float nearDiff) {
    if (u_flatDepth > 0.0) return u_flatDepth;
    float depth = unpackDepth(texture2D(u_depth, uv).rgb);
    float z = depth * 2.0 - 1.0;
    return nearMulFar / max(nearSum - z * nearDiff, 0.00001);
  }

  float blurRadius(float depth) {
    float difference = depth - u_focusDistance;
    float defocus = max(abs(difference) - u_focusRange, 0.0);
    float sideStrength = difference < 0.0 ? u_nearStrength : u_farStrength;
    return min(u_maxBlur, u_aperture * defocus / max(depth, 0.0001) * sideStrength);
  }

  void main() {
    vec4 original = texture2D(u_image, v_uv);
    if (u_maxBlur <= 0.001 || u_aperture <= 0.001) {
      gl_FragColor = original;
      return;
    }

    float nearMulFar = 2.0 * u_cameraNear * u_cameraFar;
    float nearSum = u_cameraFar + u_cameraNear;
    float nearDiff = u_cameraFar - u_cameraNear;

    float centerDepth = viewDepth(clamp(v_uv, vec2(0.0), vec2(1.0)), nearMulFar, nearSum, nearDiff);
    float centerRadius = blurRadius(centerDepth);

    vec2 invResolution = 1.0 / u_resolution;
    float rotRad = radians(u_rotation);
    float edge = max(u_edgeSoftness, 0.0001);
    float edgeTwice = edge * 2.0;
    float centerDepthPlusEdge = centerDepth + edge;
    float centerRadiusPlusOne = centerRadius + 1.0;

    bool polyEnabled = u_blades >= 3.0;
    float polyBlades = polyEnabled ? u_blades : 3.0;
    float polySector = 6.28318530718 / polyBlades;
    float polyHalfSector = polySector * 0.5;
    float polyCos = cos(3.14159265359 / polyBlades);

    vec4 total = original * 1.5;
    float totalWeight = 1.5;
    for (int i = 0; i < 20; i++) {
      float fi = float(i) + 0.5;
      float baseAngle = fi * 2.39996322973;
      float angle = baseAngle + rotRad;
      float normalizedRadius = sqrt(fi / 20.0);
      float localAngle = mod(baseAngle + polyHalfSector, polySector) - polyHalfSector;
      float sampleDistance = normalizedRadius * u_maxBlur *
        (polyEnabled ? polyCos / max(cos(localAngle), 0.001) : 1.0);
      vec2 sampleUV = v_uv + vec2(cos(angle), sin(angle)) * (sampleDistance * invResolution);
      vec2 clampedUV = clamp(sampleUV, vec2(0.0), vec2(1.0));
      vec4 samplePixel = texture2D(u_image, clampedUV);
      float sampleDepth = viewDepth(clampedUV, nearMulFar, nearSum, nearDiff);
      float sampleRadius = blurRadius(sampleDepth);

      // A sample contributes if its own bokeh circle reaches this pixel. Pulling samples using the center
      // radius is allowed only on the same depth layer; this prevents background colors leaking over a sharp
      // foreground silhouette while retaining natural foreground bokeh over the background.
      float sampleCoverage = 1.0 - smoothstep(sampleRadius, sampleRadius + 1.0, sampleDistance);
      float centerCoverage = 1.0 - smoothstep(centerRadius, centerRadiusPlusOne, sampleDistance);
      float depthDifference = abs(sampleDepth - centerDepth);
      float sameLayer = 1.0 - smoothstep(edge, edgeTwice, depthDifference);
      float coverage = max(sampleCoverage, centerCoverage * sameLayer);
      float behindForeground = step(centerDepthPlusEdge, sampleDepth);
      coverage *= 1.0 - behindForeground * (1.0 - sameLayer);
      float weight = coverage * (1.0 + normalizedRadius * 0.25);
      total += samplePixel * weight;
      totalWeight += weight;
    }
    vec4 blurred = total / max(totalWeight, 0.0001);
    gl_FragColor = mix(original, blurred, clamp(u_mix, 0.0, 1.0));
  }
`;
