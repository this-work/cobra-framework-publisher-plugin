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
            enableDebugFile: false
        }
    ]
]
```
