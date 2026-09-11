const composite = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_base;
  uniform sampler2D u_effect;
  uniform int u_blend;
  uniform float u_opacity;

  vec3 straightColor(vec4 p) {
    return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
  }

  void main() {
    float opacity = clamp(u_opacity, 0.0, 1.0);
    vec4 basePixel = texture2D(u_base, v_uv);
    vec4 effectPixel = texture2D(u_effect, v_uv);
    if (u_blend == 0) {
      gl_FragColor = mix(basePixel, effectPixel, opacity);
      return;
    }
    vec3 b = straightColor(basePixel);
    vec3 e = straightColor(effectPixel);
    vec3 c;
    if (u_blend == 1) {
      c = b + e;
    } else if (u_blend == 2) {
      c = b * e;
    } else if (u_blend == 3) {
      c = vec3(1.0) - (vec3(1.0) - b) * (vec3(1.0) - e);
    } else if (u_blend == 4) {
      c = mix(2.0 * b * e, vec3(1.0) - 2.0 * (vec3(1.0) - b) * (vec3(1.0) - e), step(vec3(0.5), b));
    } else if (u_blend == 5) {
      c = min(b, e);
    } else if (u_blend == 6) {
      c = max(b, e);
    } else {
      c = min(vec3(1.0), b / max(vec3(1.0) - e, vec3(0.0039215686)));
    }
    c = mix(b, c, opacity);
    float alpha = mix(basePixel.a, max(basePixel.a, effectPixel.a), opacity);
    gl_FragColor = vec4(clamp(c, 0.0, 1.0) * alpha, alpha);
  }
`;

const groupOver = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_base;
  uniform sampler2D u_effect;
  uniform int u_blend;
  uniform float u_opacity;

  vec3 straightColor(vec4 p) {
    return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
  }

  void main() {
    vec4 basePixel = texture2D(u_base, v_uv);
    vec4 effectPixel = texture2D(u_effect, v_uv);
    vec3 baseColor = straightColor(basePixel);
    vec3 effectColor = straightColor(effectPixel);
    vec3 blended = effectColor;
    if (u_blend == 1) {
      blended = baseColor + effectColor;
    } else if (u_blend == 2) {
      blended = baseColor * effectColor;
    } else if (u_blend == 3) {
      blended = vec3(1.0) - (vec3(1.0) - baseColor) * (vec3(1.0) - effectColor);
    } else if (u_blend == 4) {
      blended = mix(
        2.0 * baseColor * effectColor,
        vec3(1.0) - 2.0 * (vec3(1.0) - baseColor) * (vec3(1.0) - effectColor),
        step(vec3(0.5), baseColor)
      );
    } else if (u_blend == 5) {
      blended = min(baseColor, effectColor);
    } else if (u_blend == 6) {
      blended = max(baseColor, effectColor);
    } else if (u_blend == 7) {
      blended = min(vec3(1.0), baseColor / max(vec3(1.0) - effectColor, vec3(0.0039215686)));
    }

    float effectAlpha = effectPixel.a * clamp(u_opacity, 0.0, 1.0);
    float invEffectAlpha = 1.0 - effectAlpha;
    float outputAlpha = effectAlpha + (basePixel.a * invEffectAlpha);
    vec3 compositedColor = mix(effectColor, blended, basePixel.a);
    vec3 outputColor = (basePixel.rgb * invEffectAlpha) + (compositedColor * effectAlpha);
    gl_FragColor = vec4(clamp(outputColor, 0.0, 1.0), outputAlpha);
  }
`;

const matteOver = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_base;
  uniform sampler2D u_source;
  uniform sampler2D u_matte;
  uniform int u_mode;

  vec3 straightColor(vec4 p) {
    return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
  }

  void main() {
    vec4 basePixel = texture2D(u_base, v_uv);
    vec4 sourcePixel = texture2D(u_source, v_uv);
    vec4 mattePixel = texture2D(u_matte, v_uv);
    float matteValue = mattePixel.a;
    if (u_mode == 1 || u_mode == 3) {
      matteValue = dot(straightColor(mattePixel), vec3(0.2126, 0.7152, 0.0722)) * mattePixel.a;
    }
    if (u_mode >= 2) matteValue = 1.0 - matteValue;
    vec4 maskedSource = sourcePixel * clamp(matteValue, 0.0, 1.0);
    float inverseAlpha = 1.0 - maskedSource.a;
    gl_FragColor = vec4(
      maskedSource.rgb + (basePixel.rgb * inverseAlpha),
      maskedSource.a + (basePixel.a * inverseAlpha)
    );
  }
`;

const stack = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_accum;
  uniform sampler2D u_sample;
  uniform int u_mode;
  uniform int u_first;
  uniform float u_accumWeight;
  uniform float u_sampleWeight;

  vec3 straightColor(vec4 p) {
    return p.a > 0.00001 ? p.rgb / p.a : vec3(0.0);
  }

  void main() {
    vec4 samplePixel = texture2D(u_sample, v_uv);
    if (u_first == 1) {
      gl_FragColor = u_mode == 1 ? samplePixel * u_sampleWeight : samplePixel;
      return;
    }
    vec4 accumPixel = texture2D(u_accum, v_uv);
    if (u_mode == 0) {
      float totalWeight = max(u_accumWeight + u_sampleWeight, 0.00001);
      gl_FragColor = (accumPixel * u_accumWeight + samplePixel * u_sampleWeight) / totalWeight;
    } else if (u_mode == 1) {
      gl_FragColor = accumPixel + samplePixel * u_sampleWeight;
    } else {
      float accumLuminance = dot(straightColor(accumPixel), vec3(0.2126, 0.7152, 0.0722));
      float sampleLuminance = dot(straightColor(samplePixel), vec3(0.2126, 0.7152, 0.0722));
      bool useSample = u_mode == 2 ? sampleLuminance > accumLuminance : sampleLuminance < accumLuminance;
      gl_FragColor = useSample ? samplePixel : accumPixel;
    }
  }
`;

export {composite, groupOver, matteOver, stack};
