/* eslint-disable */

import Cast from '../../util/cast';
import {getContextDepthResource} from '../movie-depth-resource';

const number = value => {
    const result = Cast.toNumber(value);
    return Number.isFinite(result) ? result : 0;
};

const numberOr = (value, fallback) => (
    value === undefined || value === null || value === '' ? fallback : number(value)
);

const mixAmount = value => Math.min(1, Math.max(0, numberOr(value, 100) / 100));

const evolutionAmount = value => Math.min(100000, Math.max(-100000, number(value)));

const seedAmount = value => Math.min(100000, Math.max(-100000, number(value)));

const color = value => {
    const rgb = Cast.toRgbColorObject(value);
    return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
};

const boolean = value => value === true || String(value).toLowerCase() === 'true';

const depthResource = getContextDepthResource;

const gradient = value => {
    const defaultStops = [
        {color: '#000000', position: 0},
        {color: '#ffffff', position: 1}
    ];
    let descriptor = value;
    if (typeof descriptor === 'string') {
        try {
            descriptor = JSON.parse(descriptor);
        } catch (error) {
            descriptor = null;
        }
    }
    const sourceStops = descriptor && Array.isArray(descriptor.stops) ? descriptor.stops : defaultStops;
    const stops = sourceStops.map(stop => ({
        color: color(stop && stop.color || '#000000'),
        position: Math.min(1, Math.max(0, numberOr(stop && stop.position, 0)))
    })).slice(0, 8);
    if (!stops.length) {
        return defaultStops.map(stop => ({
            color: color(stop.color),
            position: stop.position
        }));
    }
    stops.sort((a, b) => a.position - b.position);
    return stops;
};

export {
    boolean,
    color,
    depthResource,
    evolutionAmount,
    gradient,
    mixAmount,
    number,
    numberOr,
    seedAmount
};
