const consola = require('consola');
const fs = require('fs-extra');
const path = require('path');

import fetch from 'node-fetch';

export default class Exporter {

    constructor(host, destination = 'dist', chunkSize = 250, payloadFileName = 'payload.js', payloadFilePath = '/_nuxt/static') {

        this.api = host;
        this.assetDestination = destination;
        this.assetList = [];
        this.chunkSize = chunkSize;
        this.payloadFileName = payloadFileName;
        this.payloadFilePath = payloadFilePath;

    }

    collect() {
        this.searchPayloadsInFolder(path.join(
            process.env.PWD,
            this.assetDestination + this.payloadFilePath,
        ));
    }

    collectFromString(payloadString) {
        const getAssetPathsRegex = new RegExp('\"\/(?:assets|imager)(.[^\\"]*)\"', 'g');
        let matchedStrings;
        while ((matchedStrings = getAssetPathsRegex.exec(payloadString)) !== null) {
            const trimmedMatchedStrings = matchedStrings[0].replaceAll('"', '').replaceAll(',', ' ');
            this.assetList.push(trimmedMatchedStrings);
        }
    }

    searchPayloadsInFolder(dir) {

        const files = fs.readdirSync(dir);

        for (const file of files) {

            const filePath = path.join(dir, file);
            const fileStat = fs.statSync(filePath);

            if (fileStat.isDirectory()) {
                this.searchPayloadsInFolder(filePath);
            } else if (file.endsWith(this.payloadFileName)) {
                const json = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' });
                this.collectFromString(json.replaceAll('\\u002F', '/'))
            }
        }
    }

    async download() {

        if (this.assetList.length > 0) {

            let downloadedAssets = 0;
            const chunkSize = this.chunkSize;
            const totalAssetCount = this.assetList.length;
            const progressInterval = Math.ceil(totalAssetCount * 0.05);

            consola.info(`Start download ${totalAssetCount} assets with a chunk size of ${chunkSize}`);

            const assetArray = this.assetList
            for (let i = 0; i < assetArray.length; i += chunkSize) {

                const loadAssetChunk = assetArray.slice(i, i + chunkSize);

                await Promise.all(loadAssetChunk.map(async (asset) => {
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
                }));
            }

            consola.success(`Downloaded all ${totalAssetCount} assets`);

        }

    }

}
