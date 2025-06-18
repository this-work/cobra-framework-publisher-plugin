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
     * @param {number} [config.logLevel=3] - Log level (see: https://github.com/unjs/consola#log-level)
     * @param {boolean} [config.enableDebugFile=false] - Whether to create and write debug file
     */
    constructor({
        host,
        destination = 'dist',
        concurrentDownloads = 200,
        payloadFileName = 'payload.js',
        payloadFilePath = '/_nuxt/static',
        enableDebugFile = false,
        logLevel = 3
    }) {
        this.api = host;
        this.assetDestination = destination;
        this.concurrentDownloads = concurrentDownloads;
        this.payloadFileName = payloadFileName;
        this.payloadFilePath = payloadFilePath;
        this.assetList = [];
        this.logPrefix = 'cobra-framework-publisher-plugin';
        this.logFilePath = path.join(process.env.PWD, `${this.assetDestination}/publisher.log`);
        this.enableDebugFile = enableDebugFile;
        this.debugFilePath = enableDebugFile
            ? path.join(process.env.PWD, `${this.assetDestination}/debug.log`)
            : null;
        this.logLevel = logLevel;

        this.setupLogging();
    }

    /**
     * Sets up logging configuration
     * @private
     */
    setupLogging() {
        // Create a new consola instance with both file and stdout logging
        this.logger = createConsola({
            level: this.logLevel,
            reporters: [
                // Use default fancy reporter for stdout
                {
                    log: logObj => {
                        // Only output messages below debug level in console
                        if (logObj.level <= 3) {
                            // Let consola handle the fancy formatting
                            console[logObj.type]?.(`[${this.logPrefix}]`, ...logObj.args) ||
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

        if (this.enableDebugFile) {
            this.logger.info(`Debug URL collection file: ${this.debugFilePath}`);
            // Clear the debug file at start
            fs.writeFileSync(this.debugFilePath, `Starting URL collection at ${new Date().toISOString()}\n`);
        }

        const payloadDir = path.join(process.env.PWD, `${this.assetDestination}${this.payloadFilePath}`);
        const assetSet = new Set();
        let totalBeforeDedup = 0;
        let filesProcessed = 0;

        this.processPayloadsStreaming(payloadDir, (payloadContent, filePath) => {
            filesProcessed++;
            this.logger.debug(`Processing payload file ${filesProcessed}: ${filePath}`);

            if (this.enableDebugFile) {
                fs.appendFileSync(this.debugFilePath, `\n--- Processing file ${filesProcessed}: ${filePath} ---\n`);
            }

            const assets = this.extractAssetPathsFromPayload(payloadContent);
            totalBeforeDedup += assets.length;

            // Log each asset as we collect it
            assets.forEach(asset => {
                assetSet.add(asset);
                if (this.enableDebugFile) {
                    fs.appendFileSync(this.debugFilePath, `${asset}\n`);
                }
            });

            if (this.enableDebugFile) {
                fs.appendFileSync(
                    this.debugFilePath,
                    `File processed. Found ${assets.length} assets. Total unique so far: ${assetSet.size}\n`
                );
            }

            // Log progress every 10 files
            if (filesProcessed % 10 === 0) {
                this.logger.info(
                    `Processed ${filesProcessed} payload files. Found ${assetSet.size} unique assets so far.`
                );
            }
        });

        this.assetList = Array.from(assetSet);
        const duplicatesRemoved = totalBeforeDedup - this.assetList.length;

        // Final debug log
        if (this.enableDebugFile) {
            fs.appendFileSync(this.debugFilePath, `\n=== COLLECTION COMPLETE ===\n`);
            fs.appendFileSync(this.debugFilePath, `Total payload files processed: ${filesProcessed}\n`);
            fs.appendFileSync(this.debugFilePath, `Total URLs before dedup: ${totalBeforeDedup}\n`);
            fs.appendFileSync(this.debugFilePath, `Unique URLs collected: ${this.assetList.length}\n`);
            fs.appendFileSync(this.debugFilePath, `Duplicates removed: ${duplicatesRemoved}\n`);
            fs.appendFileSync(this.debugFilePath, `Completed at: ${new Date().toISOString()}\n`);
        }

        this.logger.info(
            `Found ${this.assetList.length} unique assets (${totalBeforeDedup} total, ${duplicatesRemoved} duplicates removed)`
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
     * Processes payload files one by one without loading all content into memory
     * @param {string} dir - Directory path to search in
     * @param {Function} callback - Function to call for each payload file content
     * @private
     */
    processPayloadsStreaming(dir, callback) {
        const files = fs.readdirSync(dir);

        // Process each file in directory
        for (const file of files) {
            const filePath = path.join(dir, file);

            // Recursively search subdirectories
            if (fs.statSync(filePath).isDirectory()) {
                this.processPayloadsStreaming(filePath, callback);
                continue;
            }

            // Skip files that don't match the configured payloadFileName
            if (!file.endsWith(this.payloadFileName)) {
                continue;
            }

            // Read and process payload file immediately (don't accumulate)
            const payloadJsonRaw = fs.readFileSync(filePath, 'utf8');
            // Convert unicode forward slashes (\u002F) to regular forward slashes (/)
            const payloadJson = payloadJsonRaw.replaceAll('\\u002F', '/');
            callback(payloadJson, filePath);
        }
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
        let completedCount = 0;
        const failedAssets = [];

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

                    completedCount++;
                    if (completedCount % progressInterval === 0 || completedCount === totalAssetCount) {
                        const pctage = Math.round((completedCount / totalAssetCount) * 100);
                        this.logger.info(`Downloaded ${pctage}% of all assets (${completedCount}/${totalAssetCount})`);
                    }
                } catch (error) {
                    this.logger.error(`Failed to download asset: ${asset} - ${error.message}`);
                    failedAssets.push(asset);
                    throw error;
                }
            });
        });

        // Wait for all concurrent downloads to complete
        try {
            this.logger.info(`Starting download of ${totalAssetCount} assets (concurrency: ${concurrentDownloads})`);
            await Promise.all(downloadPromises);
            this.logger.success(`Downloaded all ${totalAssetCount} assets`);
        } catch (error) {
            this.logger.error(`Some downloads failed: ${error.message}`);
            // Log all failed assets
            if (failedAssets.length > 0) {
                this.logger.error(`Failed assets (${failedAssets.length}):`);
                for (const failedAsset of failedAssets) {
                    this.logger.error(`  - ${failedAsset}`);
                }
            }
            throw error;
        }
    }
}
