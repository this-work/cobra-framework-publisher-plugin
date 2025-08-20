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
 * @param {number} [moduleOptions.logLevel] - Log level (see: https://github.com/unjs/consola#log-level)
 * @param {boolean} [moduleOptions.enableDebugFile] - Enable debug file
 * @param {Function} [moduleOptions.provideAssets] - Optional function that returns an array or promise of asset URLs to always download
 * @returns {Promise<void>}
 */
export default async function (moduleOptions) {
    const host = this.nuxt.options.publicRuntimeConfig.API;
    if (!host?.length) {
        consola.warn('No API configured');
        return;
    }

    if (!assetLoader) {
        assetLoader = new AssetLoader({ nuxtContext: this.nuxt, host, ...moduleOptions });
    }

    this.nuxt.hook('generate:done', async (generator, errors) => {
        if (errors.length > 0) {
            const errorLogPath = `${generator.options.generate.dir}/error.log`;
            const errorLogContent = JSON.stringify({
                routes: Array.from(generator.generatedRoutes),
                errors: errors.map(({ type, route, error }) => ({ type, route, error: error.toString() }))
            });
            fs.appendFileSync(errorLogPath, errorLogContent);
            throw new Error(`Error during generation. Error log written to: ${errorLogPath}`);
        }

        await assetLoader.collect();
        await assetLoader.download();

        const successLogPath = `${generator.options.generate.dir}/success.log`;
        fs.appendFileSync(successLogPath, 'success');
    });
}
