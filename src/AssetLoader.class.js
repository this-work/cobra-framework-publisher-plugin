import consola from 'consola';
import fs from 'fs-extra';
import fetch from 'node-fetch';
import { pipeline } from 'node:stream/promises';
import pLimit from 'p-limit';
import path from 'path';

export default class AssetLoader {
    /**
     * Creates a new AssetLoader instance
     * @param {Object} config - Configuration object
     * @param {string} config.host - The API host URL where assets will be downloaded from
     * @param {string} [config.destination="dist"] - The destination directory for downloaded assets
     * @param {number} [config.chunkSize=250] - Number of assets to download concurrently
     * @param {string} [config.payloadFileName="payload.js"] - Name of the Nuxt payload files to scan
     * @param {string} [config.payloadFilePath="/_nuxt/static"] - Path where payload files are located
     */
    constructor({
        host,
        destination = 'dist',
        chunkSize = 250,
        payloadFileName = 'payload.js',
        payloadFilePath = '/_nuxt/static'
    }) {
        this.api = host;
        this.assetDestination = destination;
        this.chunkSize = chunkSize;
        this.payloadFileName = payloadFileName;
        this.payloadFilePath = payloadFilePath;
        this.assetList = [];
    }

    /**
     * Initiates the collection of assets by searching through payload files in the specified directory structure
     */
    collect() {
        const payloadDir = path.join(process.env.PWD, `${this.assetDestination}${this.payloadFilePath}`);
        const payloadContents = this.getPayloads(payloadDir);
        const assets = payloadContents.flatMap(content => this.extractAssetPathsFromPayload(content));
        this.assetList = [...new Set(assets)]; // Remove duplicates
    }

    /**
     * Extracts asset paths from a payload file content using regex
     * @param {string} payloadString - Content of the payload file
     * @returns {string[]} Array of asset paths found in the payload
     * @private
     */
    extractAssetPathsFromPayload(payloadString) {
        const getAssetPathsRegex = /\/(?:assets|imager)(.[^"]*)/g;
        const matches = [...payloadString.matchAll(getAssetPathsRegex)];
        const paths = matches.map(match => {
            const path = match[0].replaceAll('"', '').replaceAll(',', '');
            return path;
        });
        return paths;
    }

    /**
     * Recursively searches for payload files in the given directory and its subdirectories
     * @param {string} dir - Directory path to search in
     * @returns {string[]} Array of payload file contents
     * @private
     */
    getPayloads(dir) {
        const files = fs.readdirSync(dir);
        const payloadContents = [];

        // Process each file in directory
        for (const file of files) {
            const filePath = path.join(dir, file);

            // Recursively search subdirectories
            if (fs.statSync(filePath).isDirectory()) {
                const subDirContents = this.getPayloads(filePath);
                payloadContents.push(...subDirContents);
                continue;
            }

            // Skip files that don't match the configured payloadFileName
            if (!file.endsWith(this.payloadFileName)) {
                continue;
            }

            // Read payload file content (assume JSON format)
            const payloadJsonRaw = fs.readFileSync(filePath, 'utf8');
            // Convert unicode forward slashes (\u002F) to regular forward slashes (/)
            const payloadJson = payloadJsonRaw.replaceAll('\\u002F', '/');
            payloadContents.push(payloadJson);
        }

        return payloadContents;
    }

    /**
     * Downloads all collected assets with concurrency limit (configured via chunkSize)
     * @returns {Promise<void>} Resolves when all assets have been downloaded
     */
    async download() {
        if (this.assetList.length === 0) {
            consola.warn('No assets to download');
            return;
        }

        const { assetList, api, assetDestination, chunkSize } = this;
        let downloadedAssets = 0;
        const totalAssetCount = assetList.length;
        const progressInterval = Math.ceil(totalAssetCount * 0.05);

        // Create a new limiter instance with configured concurrency
        const limit = pLimit(chunkSize);
        consola.info(`Starting downloading of ${totalAssetCount} assets with concurrency limit of ${chunkSize}`);
        const downloadPromises = assetList.map(asset =>
            limit(async () => {
                const splitAssetArray = asset.split('/');
                const assetName = splitAssetArray.pop();
                const assetPath = splitAssetArray.join('/');

                try {
                    // Fetch asset from API
                    const response = await fetch(`${api}${asset}`);
                    if (!response.ok) {
                        throw new Error(`Bad response! status: ${response.status} for asset: ${asset}`);
                    }

                    // Ensure asset directory exists
                    const assetDir = path.join(process.env.PWD, `${assetDestination}${assetPath}`);
                    fs.mkdirSync(assetDir, { recursive: true });

                    // Stream fetched asset to local file
                    const assetFilePath = path.join(assetDir, assetName);
                    await pipeline(response.body, fs.createWriteStream(assetFilePath));

                    // Update progress tracking
                    downloadedAssets++;
                    if (downloadedAssets % progressInterval === 0 || downloadedAssets === totalAssetCount) {
                        const percentage = Math.round((downloadedAssets / totalAssetCount) * 100);
                        consola.info(
                            `Downloaded ${percentage}% of all assets (${downloadedAssets}/${totalAssetCount})`
                        );
                    }
                } catch (error) {
                    consola.error(`Failed to download asset: ${asset}`, error);
                    throw error;
                }
            })
        );

        // Wait for all concurrent downloads to complete
        try {
            await Promise.all(downloadPromises);
            consola.success(`Downloaded all ${totalAssetCount} assets`);
        } catch (error) {
            consola.error('Some downloads failed:', error);
            throw error;
        }
    }
}
