export default (filename, blob) => {
    if (typeof window !== 'undefined' && window.shadingDesktop &&
        typeof window.shadingDesktop.saveBlob === 'function') {
        return Promise.resolve(window.shadingDesktop.saveBlob(filename, blob))
            .catch(error => {
                if (!error || error.name !== 'AbortError') {
                    // eslint-disable-next-line no-console
                    console.error('Could not save file:', error);
                }
            });
    }
    const downloadLink = document.createElement('a');
    document.body.appendChild(downloadLink);

    // Use special ms version if available to get it working on Edge.
    if (navigator.msSaveOrOpenBlob) {
        navigator.msSaveOrOpenBlob(blob, filename);
        return;
    }

    if ('download' in HTMLAnchorElement.prototype) {
        const url = window.URL.createObjectURL(blob);
        downloadLink.href = url;
        downloadLink.download = filename;
        downloadLink.type = blob.type;
        downloadLink.click();
        // remove the link after a timeout to prevent a crash on iOS 13 Safari
        window.setTimeout(() => {
            document.body.removeChild(downloadLink);
            window.URL.revokeObjectURL(url);
        }, 1000);
    } else {
        // iOS 12 Safari, open a new page and set href to data-uri
        let popup = window.open('', '_blank');
        const reader = new FileReader();
        reader.onloadend = function () {
            popup.location.href = reader.result;
            popup = null;
        };
        reader.readAsDataURL(blob);
    }

};
