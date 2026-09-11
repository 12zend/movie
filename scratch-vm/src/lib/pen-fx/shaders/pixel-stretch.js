export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform int u_type;
  uniform float u_position;
  uniform float u_size;
  uniform float u_sampleSize;
  uniform vec2 u_center;
  uniform float u_mix;

  const float pi = 3.14159265358979323846;

  float wrappedAngle(float angle) {
    return mod(angle + pi, pi * 2.0) - pi;
  }

  vec4 samplePixel(vec2 pixel, vec2 invResolution) {
    if (any(lessThan(pixel, vec2(0.0))) || any(greaterThanEqual(pixel, u_resolution))) {
      return vec4(0.0);
    }
    return texture2D(u_image, (floor(pixel) + vec2(0.5)) * invResolution);
  }

  vec4 samplePosition(vec2 pixel, vec2 invResolution) {
    if (any(lessThan(pixel, vec2(0.0))) || any(greaterThanEqual(pixel, u_resolution))) {
      return vec4(0.0);
    }
    return texture2D(u_image, pixel * invResolution);
  }

  void main() {
    vec2 invResolution = 1.0 / u_resolution;
    vec2 pixel = v_uv * u_resolution;
    vec2 center = u_resolution * 0.5 + u_center;
    vec2 fromCenter = pixel - center;
    float halfSize = abs(u_size) * 0.5;
    bool active = false;
    vec2 sampleBase = pixel;
    vec2 sampleDirection = vec2(0.0);
    float sampleStep = 1.0;

    if (u_type < 2) {
      float axisPosition = u_type == 0 ? pixel.x : pixel.y;
      float axisCenter = u_type == 0 ? center.x : center.y;
      float axisLimit = u_type == 0 ? u_resolution.x : u_resolution.y;
      float sourcePosition = clamp(axisCenter + u_position, 0.5, axisLimit - 0.5);
      float distanceFromSource = axisPosition - sourcePosition;
      active = abs(distanceFromSource) <= halfSize;
      float edgePosition = axisPosition - sign(distanceFromSource) * halfSize;
      if (u_type == 0) {
        sampleBase.x = active ? sourcePosition : edgePosition;
        sampleDirection = vec2(1.0, 0.0);
      } else {
        sampleBase.y = active ? sourcePosition : edgePosition;
        sampleDirection = vec2(0.0, 1.0);
      }
    } else if (u_type == 2) {
      float radius = length(fromCenter);
      float sourceRadius = max(0.0, abs(u_position));
      vec2 radial = radius > 0.0001 ? fromCenter / radius : vec2(1.0, 0.0);
      float distanceFromSource = radius - sourceRadius;
      active = abs(distanceFromSource) <= halfSize || sourceRadius < halfSize && radius <= sourceRadius + halfSize;
      float sampleRadius = active ? sourceRadius : max(0.0, radius - sign(distanceFromSource) * halfSize);
      sampleBase = center + radial * sampleRadius;
      sampleDirection = radial;
    } else {
      float sourceAngle = radians(u_position);
      float angle = atan(fromCenter.y, fromCenter.x);
      float angularDistance = wrappedAngle(angle - sourceAngle);
      float halfAngle = radians(halfSize);
      active = abs(angularDistance) <= halfAngle;
      float radius = length(fromCenter);
      float sampleAngle = active ? sourceAngle : angle - sign(angularDistance) * halfAngle;
      sampleBase = center + vec2(cos(sampleAngle), sin(sampleAngle)) * radius;
      sampleStep = max(radius * (pi / 180.0), 0.25);
      sampleDirection = vec2(-sin(sourceAngle), cos(sourceAngle));
    }

    vec4 transformed;
    if (active) {
      transformed = vec4(0.0);
      float samples = 0.0;
      float sampleLimit = min(abs(u_sampleSize) * 0.5, 4.0);
      vec2 sampleOffset = sampleDirection * sampleStep;
      for (int i = -4; i <= 4; i++) {
        float fi = float(i);
        float sampleActive = step(abs(fi), sampleLimit);
        transformed += samplePixel(sampleBase + sampleOffset * fi, invResolution) * sampleActive;
        samples += sampleActive;
      }
      transformed /= max(samples, 1.0);
    } else {
      transformed = samplePosition(sampleBase, invResolution);
    }
    float mixValue = clamp(u_mix, 0.0, 1.0);
    gl_FragColor = mixValue == 1.0 ? transformed : mix(texture2D(u_image, v_uv), transformed, mixValue);
  }
`;
