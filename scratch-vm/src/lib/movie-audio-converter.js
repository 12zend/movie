import WavEncoder from 'wav-encoder';

const getAudioContext = () => {
    if (typeof window === 'undefined') return null;
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    return AudioContextConstructor ? new AudioContextConstructor() : null;
};

/**
 * Convert an audio file to WAV using an existing VM audio context when one is
 * available, falling back to a browser context for file-upload flows.
 *
 * @param {ArrayBuffer} fileData encoded audio data
 * @param {AudioContext} audioContext optional existing audio context
 * @returns {Promise<ArrayBuffer>} encoded WAV data
 */
const convertAudioToWav = (fileData, audioContext = null) => {
    const context = audioContext || getAudioContext();
    if (!context) {
        return Promise.reject(new Error('Audio conversion is not available.'));
    }

    return context.decodeAudioData(fileData)
        .then(decodedData => {
            const channels = [];
            for (let i = 0; i < decodedData.numberOfChannels; i++) {
                channels.push(decodedData.getChannelData(i));
            }
            return WavEncoder.encode({
                sampleRate: decodedData.sampleRate,
                channelData: channels
            });
        });
};

export default convertAudioToWav;
