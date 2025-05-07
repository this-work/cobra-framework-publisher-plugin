const consola = require('consola');
const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');

export default class Exporter {

    constructor(host, destination) {

        this.api = host;
        this.assetDestination = destination;
        this.assetList = [];

    }

    async collectAssets(page, html) {

        consola.info(`Collect Assets of "${page}"`);

        this.assetList = [];
        const getAssetPathsRegex = new RegExp('\"\/(?:assets|imager)(.[^\\"]*)\"', 'g');

        let matchedStrings;
        while ((matchedStrings = getAssetPathsRegex.exec(html)) !== null) {
            this.assetList.push(matchedStrings[0].replaceAll('"', ''));
        }

        consola.info(`Found ${this.assetList.length} assets`);

        await Promise.all(this.assetList.map(async asset => {

            const splittedAssetArray = asset.split('/');
            const assetName = splittedAssetArray.pop();
            const assetPath = splittedAssetArray.join('/');

            fs.mkdirSync(path.join(
                process.env.PWD,
                this.assetDestination + assetPath,
            ), { recursive: true })

            return await fetch(asset).then(res =>
                res.body.pipe(fs.createWriteStream(path.join(
                        process.env.PWD,
                    this.assetDestination + assetPath,
                        assetName
                    )
                ))
            )

        }));

        consola.success(`Downloaded all ${this.assetList.length} assets`);

    }


}
