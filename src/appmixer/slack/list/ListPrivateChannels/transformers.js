'use strict';

/**
 * Transformer for channels
 * @param {Object|string} channels
 */
module.exports.channelsToSelectArray = channels => {

    let transformed = [];

    if (Array.isArray(channels)) {
        channels.forEach(channel => {

            transformed.push({
                label: channel['name'],
                value: channel['id']
            });
        });
    }

    return transformed;
};
