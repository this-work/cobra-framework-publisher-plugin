# Cobra-Framework Pubisher Plugin

Nuxt module for a publish process. Requires a minimal version of nuxt 2.17+

### Requirements

* Nuxt 2.17+

### Usage in Nuxt

Install plugin dependencies

```bash
$ npm install @this/cobra-framework-publisher-plugin
```

Add module to `nuxt.config.js`:

```js
modules: [
    ['@this/cobra-framework-publisher-plugin']
]
```

#### Module Options

```js
modules: [
    [
        '@this/cobra-framework-publisher-plugin',
        {
            // Directory where downloaded assets will be stored
            destination: 'dist',

            // Number of assets to download concurrently
            concurrentDownloads: 200,

            // Name of the Nuxt payload files to scan
            payloadFileName: 'payload.js',

            // Path where payload files are located
            payloadFilePath: '/_nuxt/static',

            // Enable debug file
            enableDebugFile: false,

            // Timeout in milliseconds for each asset download request (default: 3 minutes)
            requestTimeout: 180000,

            // Whether to continue execution when some downloads fail (true) or throw an error (false)
            silentFail: true,

            // Optional function that returns an array of asset URLs to always download
            // Can be synchronous or async, supports relative and absolute URLs
            provideAssets: (nuxtContext) => {
                // Example of a synchronous function
                return [
                    '/assets/image1.jpg',
                    '/assets/image2.jpg',
                    'https://cdn.example.com/images/hero.jpg',
                    'https://assets.example.com/videos/intro.mp4',
                ];
            }
        }
    ]
]
```
