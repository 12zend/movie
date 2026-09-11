precision mediump float;

#ifdef DRAW_MODE_line
uniform vec2 u_stageSize;
attribute vec2 a_lineThicknessAndLength;
attribute vec4 a_penPoints;
attribute vec4 a_lineColor;

varying vec4 v_lineColor;
varying float v_lineThickness;
varying float v_lineLength;
varying vec4 v_penPoints;

const float epsilon = 1e-3;
#endif

#if !(defined(DRAW_MODE_line) || defined(DRAW_MODE_background))
uniform mat4 u_projectionMatrix;
uniform mat4 u_modelMatrix;
uniform vec2 u_effectPadding;
uniform vec2 u_skinSize;
attribute vec2 a_texCoord;
#endif

attribute vec2 a_position;

varying vec2 v_texCoord;

void main() {
    #ifdef DRAW_MODE_line
    vec2 position = a_position;
    float expandedRadius = (a_lineThicknessAndLength.x * 0.5) + 1.4142135623730951;

    v_texCoord.x = mix(0.0, a_lineThicknessAndLength.y + (expandedRadius * 2.0), a_position.x) - expandedRadius;
    v_texCoord.y = ((a_position.y - 0.5) * expandedRadius) + 0.5;

    position.x *= a_lineThicknessAndLength.y + (2.0 * expandedRadius);
    position.y *= 2.0 * expandedRadius;
    position -= expandedRadius;

    vec2 pointDiff = a_penPoints.zw;
    pointDiff.x = (abs(pointDiff.x) < epsilon && abs(pointDiff.y) < epsilon) ? epsilon : pointDiff.x;
    vec2 normalized = pointDiff / max(a_lineThicknessAndLength.y, epsilon);
    position = mat2(normalized.x, normalized.y, -normalized.y, normalized.x) * position;
    position += a_penPoints.xy;
    position *= 2.0 / u_stageSize;
    gl_Position = vec4(position, 0, 1);

    v_lineColor = a_lineColor;
    v_lineThickness = a_lineThicknessAndLength.x;
    v_lineLength = a_lineThicknessAndLength.y;
    v_penPoints = a_penPoints;
    #elif defined(DRAW_MODE_background)
    gl_Position = vec4(a_position * 2.0, 0, 1);
    #else
    // Effects such as blur and bloom need fragments outside the original skin quad.
    // Keep the costume's transform unchanged while expanding only its draw surface.
    vec2 paddingRatio = u_effectPadding / max(u_skinSize, vec2(1.0));
    vec2 expandedPosition = a_position * (vec2(1.0) + (paddingRatio * 2.0));
    gl_Position = u_projectionMatrix * u_modelMatrix * vec4(expandedPosition, 0, 1);
    v_texCoord = mix(-paddingRatio, vec2(1.0) + paddingRatio, a_texCoord);
    #endif
}
