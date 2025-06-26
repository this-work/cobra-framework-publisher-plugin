import { createConsola } from 'consola';
import fs from 'fs-extra';
import { pipeline } from 'node:stream/promises';
import { ofetch } from 'ofetch';
import pLimit from 'p-limit';
import path from 'path';
import { Transform } from 'stream';

export default class AssetLoader {
    /**
     * Creates a new AssetLoader instance
     * @param {Object} config - Configuration object
     * @param {Object} [config.nuxtContext] - Nuxt context object
     * @param {string} config.host - The API host URL where assets will be downloaded from
     * @param {string} [config.destination="dist"] - The destination directory for downloaded assets
     * @param {number} [config.concurrentDownloads=200] - Number of assets to download concurrently
     * @param {string} [config.payloadFileName="payload.js"] - Name of the Nuxt payload files to scan
     * @param {string} [config.payloadFilePath="/_nuxt/static"] - Path where payload files are located
     * @param {number} [config.logLevel=3] - Log level (see: https://github.com/unjs/consola#log-level)
     * @param {boolean} [config.enableDebugFile=false] - Whether to create and write debug file
     * @param {number} [config.requestTimeout=180000] - Timeout in milliseconds for each asset download request
     * @param {boolean} [config.silentFail=true] - Whether to continue execution when some downloads fail (true) or throw an error (false)
     * @param {Function} [config.provideAssets] - Optional function that returns an array or promise of asset URLs to always download
     */
    constructor({
        nuxtContext = null,
        host,
        destination = 'dist',
        concurrentDownloads = 200,
        payloadFileName = 'payload.js',
        payloadFilePath = '/_nuxt/static',
        enableDebugFile = false,
        logLevel = 3,
        requestTimeout = 180000,
        silentFail = true,
        provideAssets = null,
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
        this.requestTimeout = requestTimeout;
        this.silentFail = silentFail;
        this.provideAssets = provideAssets;
        this.nuxtContext = nuxtContext;
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
            fancy: true,
            formatOptions: {
                date: true,
                colors: true,
                compact: false
            }
        });

        // Add file reporter while keeping default fancy reporter
        this.logger.addReporter({
            log: logObj => {
                const timestamp = new Date().toISOString();
                const message = `[${timestamp}] ${logObj.type}: ${logObj.args.join(' ')}\n`;
                fs.appendFileSync(this.logFilePath, message);
            }
        });
        // Ensure log file path exists
        fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
    }

    /**
     * Initiates the collection of assets by searching through payload files in the specified directory structure
     * and collection of assets from the provideAssets function if provided
     * @returns {Promise<void>}
     */
    async collect() {
        this.logger.info(`Log file location: ${this.logFilePath}`);

        if (this.enableDebugFile) {
            this.logger.info(`Debug URL collection file: ${this.debugFilePath}`);
            // Clear the debug file at start
            fs.writeFileSync(this.debugFilePath, `Starting URL collection at ${new Date().toISOString()}\n`);
        }

        const assetSet = new Set();
        let totalBeforeDedup = 0;

        // Collect assets from provideAssets function if provided
        if (typeof this.provideAssets === 'function') {
            try {
                this.logger.info('Collecting provided assets...');
                let providedAssets;
                try {
                    // Handle both async and sync functions
                    providedAssets = await Promise.resolve(this.provideAssets(this.nuxtContext));
                } catch (callError) {
                    throw new Error(`Failed to execute provideAssets function: ${callError.message}`);
                }

                if (!Array.isArray(providedAssets)) {
                    throw new Error('provideAssets function must return an array of strings');
                }

                providedAssets.forEach(asset => {
                    if (typeof asset !== 'string') {
                        this.logger.warn(`Skipping invalid asset URL from provideAssets: ${asset}`);
                        return;
                    }
                    assetSet.add(asset);
                    if (this.enableDebugFile) {
                        fs.appendFileSync(this.debugFilePath, `Collected provided asset: ${asset}\n`);
                    }
                });

                totalBeforeDedup += providedAssets.length;
                this.logger.info(`Collected ${providedAssets.length} provided assets`);
            } catch (error) {
                this.logger.error(`Error collecting provided assets: ${error.message}`);
                throw error;
            }
        }

        const payloadDir = path.join(process.env.PWD, `${this.assetDestination}${this.payloadFilePath}`);
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

        const { assetList, api, assetDestination, concurrentDownloads, silentFail } = this;
        const totalAssetCount = assetList.length;
        const progressInterval = Math.ceil(totalAssetCount * 0.01);
        let completedCount = 0;
        let totalBytesDownloaded = 0;
        const failedAssets = [];

        // Helper function to format bytes into human readable format
        const formatBytes = (bytes) => {
            if (bytes === 0) return '0 B';
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(1024));
            return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
        };

        const limit = pLimit(concurrentDownloads);
        const downloadPromises = assetList.map(asset => {
            return limit(async () => {
                try {
                    const isAbsoluteURL = asset.startsWith('http://') || asset.startsWith('https://');
                    const requestURL = isAbsoluteURL ? asset : `${api}${asset}`;

                    // Extract the path for filesystem storage
                    const assetPathForFS = isAbsoluteURL
                        ? asset.replace(/^https?:\/\/[^/]+\//, '') // Remove protocol and domain
                        : asset.replace(/^\//, ''); // Remove leading slash for relative paths

                    // Split the path into directory and filename
                    const splitAssetArray = assetPathForFS.split('/');
                    const assetName = splitAssetArray.pop();
                    const assetPath = splitAssetArray.join('/');
                    const assetFilePath = path.join(assetDir, assetName);

                    // Ensure asset directory exists
                    const assetDir = path.join(process.env.PWD, `${assetDestination}/${assetPath}`);
                    fs.mkdirSync(assetDir, { recursive: true });

                    const response = await ofetch(requestURL, {
                        responseType: 'stream',
                        timeout: this.requestTimeout,
                        retry: 3,
                        onRequest: ({ request }) => {
                            this.logger.debug(`Started download: ${request} → ${assetFilePath}`);
                        },
                        onResponse: ({ request, response }) => {
                            this.logger.debug(`Completed download: ${request} (${response.status}) → ${assetFilePath}`);
                        },
                        onRequestError: ({ request, error }) => {
                            this.logger.error(`Request error: ${request}: ${error.message}`);
                        }
                    });

                    // Stream fetched asset to local file and track size
                    let assetSize = 0;

                    // Stream the response through a transform to track size, then write to file
                    await pipeline(
                        response,
                        new Transform({
                            transform(chunk, encoding, callback) {
                                assetSize += chunk.length;
                                callback(null, chunk);
                            }
                        }),
                        fs.createWriteStream(assetFilePath)
                    );

                    totalBytesDownloaded += assetSize;

                    completedCount++;
                    if (completedCount % progressInterval === 0 || completedCount === totalAssetCount) {
                        const pctage = Math.round((completedCount / totalAssetCount) * 100);
                        this.logger.info(
                            `Downloaded ${pctage}% of all assets (${completedCount}/${totalAssetCount}, ${formatBytes(totalBytesDownloaded)} total)`
                        );
                    }

                    return { success: true, asset, size: assetSize };
                } catch (error) {
                    this.logger.error(`Failed to download asset: ${asset} - ${error.message}`);
                    failedAssets.push(asset);
                    return { success: false, asset, error: error.message };
                }
            });
        });

        // Wait for all concurrent downloads to complete
        try {
            this.logger.info(`Starting download of ${totalAssetCount} assets (concurrency: ${concurrentDownloads})`);
            const results = await Promise.all(downloadPromises);

            // Count successful and failed downloads
            const successfulDownloads = results.filter(r => r.success).length;
            const failedDownloads = results.filter(r => !r.success).length;

            if (failedDownloads > 0) {
                this.logger.error(`Completed with errors: ${successfulDownloads} successful, ${failedDownloads} failed`);
                this.logger.error(`Total data downloaded: ${formatBytes(totalBytesDownloaded)}`);
                this.logger.error(`Failed assets (${failedAssets.length}):`);
                for (const failedAsset of failedAssets) {
                    this.logger.error(`  - ${failedAsset}`);
                }
                if (!silentFail) {
                    throw new Error(`Some downloads failed (${failedDownloads} of ${totalAssetCount})`);
                }
            } else {
                this.logger.success(`Successfully downloaded all ${totalAssetCount} assets (${formatBytes(totalBytesDownloaded)})`);
            }
        } catch (error) {
            this.logger.error(`Download process error: ${error.message}`);
            if (!silentFail) {
                throw error;
            }
        }
    }
}
