const COSTUME_FILE_ACCEPT = '.svg, .png, .bmp, .jpg, .jpeg, .jfif, .webp, .gif, .exr';

const getFileType = file => (/\.exr$/i.test(file.name) ? 'image/x-exr' : file.type);

export {
    COSTUME_FILE_ACCEPT,
    getFileType
};
