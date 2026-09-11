const BLEND_MODES = ['normal', 'add', 'mul', 'screen', 'overlay', 'darken', 'lighten', 'color dodge'];

const FRACTAL_TYPES = [
    '基本', 'タービュレント(滑らか)', 'タービュレント(基本)', 'タービュレント(シャープ)',
    'ダイナミック', 'ダイナミック（プログレッシブ）', 'ダイナミック（ツイスト）', '最大', 'にじみ',
    '渦巻き', '岩肌', '曇り雲', '土', 'サブスケール', '小さなバンプ', 'ストリング', 'スレッド'
];

const FRACTAL_NOISE_TYPES = ['ブロック', 'リニア', 'ソフトリニア', 'スプライン'];
const FRACTAL_OVERFLOW_TYPES = ['HDR', 'Clip', 'Soft clamp'];

export {
    BLEND_MODES,
    FRACTAL_TYPES,
    FRACTAL_NOISE_TYPES,
    FRACTAL_OVERFLOW_TYPES
};
