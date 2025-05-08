/**
 * Cobra - Publisher
 *
 * @description Nuxt module for a publish process.
 * Requires a minimal version of nuxt 2.17+
 *
 * @version 1.0.0
 * @author Tobias Wöstmann
 *
 */

const fs = require('fs-extra');
import AssetLoaderClass from './AssetLoader.class';

let publisherAlreadyStarted = false;
let AssetLoader = false;

export default async function(moduleOptions) {

    const { nuxt } = this;

    const nuxtConfig = nuxt.options;

    if (nuxtConfig.publicRuntimeConfig.API.length > 0) {

        if (!publisherAlreadyStarted) {

            publisherAlreadyStarted = true;

            AssetLoader = new AssetLoaderClass(
                nuxtConfig.publicRuntimeConfig.API,
                'dist'
            );

        }

        this.nuxt.hook('generate:page', async ({route, html}) => {

            await AssetLoader.collectPageAssets(route, html);

        });

        this.nuxt.hook("generate:done", async (generator, errors) => {

            await AssetLoader.downloadAssets(route, html);

            if (errors.length > 0) {

                fs.writeFileSync(
                    generator.options.generate.dir + '/error.log',
                    JSON.stringify(
                        { 'routes': Array.from(generator.generatedRoutes),
                            'errors': errors.map(error => {
                                return {
                                    type: error.type,
                                    route: error.route,
                                    error: error.error.toString()
                                };
                            }) }
                    )
                );
            } else {

                fs.writeFileSync(
                    generator.options.generate.dir + '/success.log',
                    'success'
                );

            }

        });

    }

}
