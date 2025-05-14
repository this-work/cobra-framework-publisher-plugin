/**
 * Cobra - Publisher
 *
 * @module @this/cobra-framework-publisher-plugin
 * @description Nuxt module for a publish process.
 *
 * @requires nuxt ^2.17.0
 * @author Tobias Wöstmann
 * @version 1.0.0
 */

import fs from 'fs-extra';
import AssetLoader from './AssetLoader.class.js';

/** @type {import('./AssetLoader.class.js').default|null} */
let assetLoader = null;

/**
 * @param {Object} moduleOptions - Options passed to the module in nuxt config definition
 * @param {string} [moduleOptions.destination] - Destination directory for downloaded assets
 * @param {number} [moduleOptions.concurrentDownloads] - Number of assets to download concurrently
 * @param {string} [moduleOptions.payloadFileName] - Name of the payload files to scan
 * @param {string} [moduleOptions.payloadFilePath] - Path where payload files are located
 * @returns {Promise<void>}
 */
export default async function (moduleOptions) {
    const host = this.nuxt.options.publicRuntimeConfig.API;

    if (!host?.length) {
        consola.warn('No API configured');
        return;
    }

    if (!assetLoader) {
        assetLoader = new AssetLoader({ host, ...moduleOptions });
    }

    this.nuxt.hook('generate:done', async (generator, errors) => {
        assetLoader.collect();
        await assetLoader.download();

        const logPath = `${generator.options.generate.dir}/${errors.length > 0 ? 'error' : 'success'}.log`;
        const logContent =
            errors.length > 0
                ? JSON.stringify({
                      routes: Array.from(generator.generatedRoutes),
                      errors: errors.map(({ type, route, error }) => ({ type, route, error: error.toString() }))
                  })
                : 'success';
        fs.writeFileSync(logPath, logContent);
    });
}
