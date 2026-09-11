export default `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  void main() {
    gl_FragColor = texture2D(u_image, v_uv);
  }
`;
