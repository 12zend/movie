export default `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform int u_mode;
  uniform int u_type;
  uniform float u_value;
  uniform float u_radius;
  uniform vec2 u_center;
  uniform vec2 u_offset;
  uniform vec2 u_anchor;
  uniform vec2 u_blockSize;
  uniform float u_size;
  uniform float u_direction;
  uniform float u_width;
  uniform float u_frequency;
  uniform float u_mix;

  void main() {
    vec2 uv = v_uv;
    vec2 invResolution = 1.0 / u_resolution;
    if (u_mode == 0) {
      vec2 centerPixel = u_resolution * 0.5 + u_center;
      vec2 fromCenter = v_uv * u_resolution - centerPixel;
      float distanceFromCenter = length(fromCenter);
      float bandOffset = distanceFromCenter - abs(u_radius);
      vec2 radial = distanceFromCenter > 0.001 ? fromCenter / distanceFromCenter : vec2(1.0, 0.0);
      float rcpWidth = 1.0 / max(abs(u_width), 0.001);
      float envelope = exp(-abs(bandOffset) * rcpWidth);
      float wave = sin(bandOffset * u_frequency) * envelope;
      uv -= radial * (wave * u_value) * invResolution;
    } else if (u_mode == 1) {
      vec2 blockSize = max(floor(abs(u_blockSize) + 0.5), vec2(1.0));
      vec2 blockOrigin = blockSize * 0.5 + u_offset;
      vec2 pixel = floor((v_uv * u_resolution - u_offset) / blockSize) * blockSize + blockOrigin;
      uv = pixel * invResolution;
    } else if (u_mode == 2) {
      vec2 mirrorCenter = u_resolution * 0.5 + u_center;
      vec2 pixel = v_uv * u_resolution;
      if (u_type == 0 || u_type == 2) pixel.x = 2.0 * mirrorCenter.x - pixel.x;
      if (u_type == 1 || u_type == 2) pixel.y = 2.0 * mirrorCenter.y - pixel.y;
      uv = pixel * invResolution;
    } else {
      vec2 anchor = u_resolution * 0.5 + u_anchor;
      vec2 pixel = v_uv * u_resolution - (anchor + u_offset);
      float scale = max(abs(u_size) / 100.0, 0.0001);
      float angle = radians(-u_direction);
      float sinAngle = sin(angle);
      float cosAngle = cos(angle);
      pixel = mat2(cosAngle, -sinAngle, sinAngle, cosAngle) * pixel * (1.0 / scale);
      uv = (pixel + anchor) * invResolution;
      if (u_mode == 4) uv = fract(uv);
    }
    float mixValue = clamp(u_mix, 0.0, 1.0);
    if (any(lessThan(vec4(uv, 1.0 - uv), vec4(0.0)))) {
      gl_FragColor = mixValue == 1.0 ? vec4(0.0) : mix(texture2D(u_image, v_uv), vec4(0.0), mixValue);
    } else {
      vec4 transformedPixel = texture2D(u_image, uv);
      gl_FragColor = mixValue == 1.0 ? transformedPixel : mix(texture2D(u_image, v_uv), transformedPixel, mixValue);
    }
  }
`;
