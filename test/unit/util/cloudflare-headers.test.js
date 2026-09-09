import fs from 'fs';
import path from 'path';

describe('Cloudflare asset loading policy', () => {
    test('permits embedded model images through the ImageBitmapLoader fetch path', () => {
        const headers = fs.readFileSync(path.resolve(__dirname, '../../../static/_headers'), 'utf8');
        const policy = headers.match(/Content-Security-Policy: ([^\n]+)/)[1];
        const directives = policy.split(';').map(directive => directive.trim().split(/\s+/));
        const connectSources = directives.find(directive => directive[0] === 'connect-src').slice(1);

        // GLTFLoader creates blob URLs for GLB bufferView images. ImageBitmapLoader
        // fetches these (and embedded data URIs), so img-src alone is insufficient.
        expect(connectSources).toEqual(expect.arrayContaining(["'self'", 'blob:', 'data:']));
        expect(connectSources).not.toContain('*');
    });
});
