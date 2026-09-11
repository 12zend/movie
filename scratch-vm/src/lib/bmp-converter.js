export default (bmpImage, type = 'image/bmp') => new Promise((resolve, reject) => {
    // If the input is a URI string, we can use it as-is. Anything else (ArrayBuffer, TypedArray, ...)
    // is converted to a `Blob` and given a URL so we can use it as an <img> `src`.
    const isUri = typeof bmpImage === 'string';
    const imageUrl = isUri ?
        bmpImage :
        window.URL.createObjectURL(new Blob([bmpImage], {type}));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const image = document.createElement('img');

    const revokeBlobUrl = () => {
        if (!isUri) {
            // Revoke URL. This allows the blob to be GC'd and prevents a memory leak.
            window.URL.revokeObjectURL(imageUrl);
        }
    };

    const cleanup = () => {
        // eslint-disable-next-line no-use-before-define
        image.removeEventListener('load', handleLoad);
        // eslint-disable-next-line no-use-before-define
        image.removeEventListener('error', handleError);
        revokeBlobUrl();
    };

    const handleLoad = () => {
        cleanup();
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        ctx.drawImage(image, 0, 0);
        resolve(canvas.toDataURL('image/png'));
    };

    const handleError = () => {
        cleanup();
        reject(new Error('Could not decode the image from the provided data.'));
    };

    image.addEventListener('load', handleLoad);
    image.addEventListener('error', handleError);

    image.setAttribute('src', imageUrl);
});
