const consola = require('consola');
const fs = require('fs-extra');
const path = require('path');

import fetch from 'node-fetch';

export default class Exporter {

    constructor(host, destination) {

        this.api = host;
        this.assetDestination = destination;
        this.assetList = [];

    }

    collectPageAssets(page, html) {

        const getAssetPathsRegex = new RegExp('\"\/(?:assets|imager)(.[^\\"]*)\"', 'g');
        const pageAssetList = [];

        let matchedStrings;
        while ((matchedStrings = getAssetPathsRegex.exec(html)) !== null) {

            const trimmedMatchedStrings = matchedStrings[0].replaceAll('"', '').replaceAll(',', ' ');

            if (trimmedMatchedStrings.includes(' ')) {

                const relatedAssetsArray = trimmedMatchedStrings.split(' ').filter((possibleAsset) => possibleAsset.charAt(0) === '/');

                relatedAssetsArray.forEach((asset) => {
                    this.assetList.push(asset)
                    pageAssetList.push(asset);
                });

            } else {
                this.assetList.push(trimmedMatchedStrings);
                pageAssetList.push(trimmedMatchedStrings);
            }

        }

        if (pageAssetList.length > 0) {
            consola.info(`Founded ${pageAssetList.length} assets for "${page}"`);
        } else {
            consola.info(`No assets found for "${page}"`);
        }

    }

    async downloadAssets() {

        if (this.assetList.length > 0) {

            let downloadedAssets = 0;
            const totalAssetCount = this.assetList.length;
            const progressInterval = Math.ceil(totalAssetCount * 0.05);

            for (const [index, asset] of this.assetList.entries()) {

                const splittedAssetArray = asset.split('/');
                const assetName = splittedAssetArray.pop();
                const assetPath = splittedAssetArray.join('/');

                fs.mkdirSync(path.join(
                    process.env.PWD,
                    this.assetDestination + assetPath,
                ), { recursive: true })

                const response = await fetch(this.api + asset);

                await new Promise((resolve, reject) => {
                    const writeStream = fs.createWriteStream(path.join(
                        process.env.PWD,
                        this.assetDestination + assetPath,
                        assetName
                    ));

                    response.body.pipe(writeStream);

                    writeStream.on('finish', () => {
                        downloadedAssets++;
                        if (downloadedAssets % progressInterval === 0 || downloadedAssets === totalAssetCount) {
                            const percentage = Math.round((downloadedAssets / totalAssetCount) * 100);
                            consola.info(`Downloaded ${percentage}% of all assets (${downloadedAssets}/${totalAssetCount})`);
                        }
                        resolve();
                    });
                    writeStream.on('error', reject);
                });
            }

            consola.success(`Downloaded all ${this.assetList.length} assets"`);

        }

    }

}
