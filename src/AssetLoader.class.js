import { createConsola } from 'consola';
import fs from 'fs-extra';
import { pipeline } from 'node:stream/promises';
import { ofetch } from 'ofetch';
import pLimit from 'p-limit';
import path from 'path';

export default class AssetLoader {
    /**
     * Creates a new AssetLoader instance
     * @param {Object} config - Configuration object
     * @param {string} config.host - The API host URL where assets will be downloaded from
     * @param {string} [config.destination="dist"] - The destination directory for downloaded assets
     * @param {number} [config.concurrentDownloads=200] - Number of assets to download concurrently
     * @param {string} [config.payloadFileName="payload.js"] - Name of the Nuxt payload files to scan
     * @param {string} [config.payloadFilePath="/_nuxt/static"] - Path where payload files are located
     */
    constructor({
        host,
        destination = 'dist',
        concurrentDownloads = 200,
        payloadFileName = 'payload.js',
        payloadFilePath = '/_nuxt/static'
    }) {
        this.api = host;
        this.assetDestination = destination;
        this.concurrentDownloads = concurrentDownloads;
        this.payloadFileName = payloadFileName;
        this.payloadFilePath = payloadFilePath;
        this.assetList = [];
        this.logPrefix = 'cobra-framework-publisher-plugin';
        this.logFilePath = path.join(process.env.PWD, `${this.assetDestination}/publisher.log`);

        this.setupLogging();
    }

    /**
     * Sets up logging configuration
     * @private
     */
    setupLogging() {
        // Create a new consola instance with both file and stdout logging
        this.logger = createConsola({
            level: 4, // Keep main level at 4 to allow debug logs
            reporters: [
                {
                    log: logObj => {
                        // Only show non-debug messages in console
                        if (logObj.level <= 3) {
                            console.log(`[${this.logPrefix}] ${logObj.type}:`, ...logObj.args);
                        }
                    }
                },
                {
                    log: logObj => {
                        const timestamp = new Date().toISOString();
                        const message = `[${timestamp}] ${logObj.type}: ${logObj.args.join(' ')}\n`;
                        fs.appendFileSync(this.logFilePath, message);
                    }
                }
            ]
        });

        // Ensure log file path exists
        fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
    }

    /**
     * Initiates the collection of assets by searching through payload files in the specified directory structure
     */
    collect() {
        this.logger.info(`Log file location: ${this.logFilePath}`);

        const payloadDir = path.join(process.env.PWD, `${this.assetDestination}${this.payloadFilePath}`);
        const payloadContents = this.getPayloads(payloadDir);
        const assets = payloadContents.flatMap(content => this.extractAssetPathsFromPayload(content));
        const totalBeforeDedup = assets.length;
        this.assetList = [...new Set(assets)];
        const duplicatesRemoved = totalBeforeDedup - this.assetList.length;
        this.logger.info(
            `Found ${this.assetList.length} unique assets (${totalBeforeDedup} total paths, ${duplicatesRemoved} duplicates removed)`
        );
    }

    /**
     * Extracts asset paths from a payload file content using regex
     * @param {string} payloadString - Content of the payload file
     * @returns {string[]} Array of asset paths found in the payload
     * @private
     */
    extractAssetPathsFromPayload(payloadString) {
        const assetPathRegex = /\/(?:assets|imager)\/[^"]+/g;
        const matches = [...payloadString.matchAll(assetPathRegex)];
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
     * Downloads all collected assets with concurrency limit (configured via concurrentDownloads)
     * @returns {Promise<void>} Resolves when all assets have been downloaded
     */
    async download() {
        if (this.assetList.length === 0) {
            this.logger.warn('No assets to download');
            return;
        }

        const { assetList, api, assetDestination, concurrentDownloads } = this;
        const totalAssetCount = assetList.length;
        const progressInterval = Math.ceil(totalAssetCount * 0.05);
        const remainingAssets = new Set(assetList);

        const limit = pLimit(concurrentDownloads);
        const downloadPromises = assetList.map(asset => {
            return limit(async () => {
                const splitAssetArray = asset.split('/');
                const assetName = splitAssetArray.pop();
                const assetPath = splitAssetArray.join('/');

                try {
                    const response = await ofetch(`${api}${asset}`, {
                        responseType: 'stream',
                        timeout: 60000, // 1 minute timeout per request
                        retry: 3,
                        onRequest: ({ request }) => {
                            this.logger.debug(`Started download: ${request}`);
                        },
                        onResponse: ({ request, response }) => {
                            this.logger.debug(`Completed download: ${request} (${response.status})`);
                        },
                        onRequestError: ({ request, error }) => {
                            this.logger.error(`Request error: ${request}: ${error.message}`);
                        }
                    });

                    // Ensure asset directory exists
                    const assetDir = path.join(process.env.PWD, `${assetDestination}${assetPath}`);
                    fs.mkdirSync(assetDir, { recursive: true });

                    // Stream fetched asset to local file
                    const assetFilePath = path.join(assetDir, assetName);
                    await pipeline(response, fs.createWriteStream(assetFilePath));

                    remainingAssets.delete(asset);
                    const completedCount = totalAssetCount - remainingAssets.size;
                    if (completedCount % progressInterval === 0 || completedCount === totalAssetCount) {
                        const percentage = Math.round((completedCount / totalAssetCount) * 100);
                        const progressMessage = `Downloaded ${percentage}% of all assets (${completedCount}/${totalAssetCount})`;
                        this.logger.info(progressMessage);
                    }
                } catch (error) {
                    this.logger.error(`Failed to download asset: ${asset} - ${error.message}`);
                    throw error;
                }
            });
        });

        // Wait for all concurrent downloads to complete
        try {
            this.logger.info(
                `Starting download of ${totalAssetCount} assets (concurrency limit: ${concurrentDownloads})`
            );
            await Promise.all(downloadPromises);
            this.logger.success(`Downloaded all ${totalAssetCount} assets`);
        } catch (error) {
            this.logger.error(`Some downloads failed: ${error.message}`);
            // Log all remaining assets that haven't been downloaded
            this.logger.error(`Failed or stuck assets (${remainingAssets.size}):`);
            for (const remainingAsset of remainingAssets) {
                this.logger.error(`  - ${remainingAsset}`);
            }
            throw error;
        }
    }
}
