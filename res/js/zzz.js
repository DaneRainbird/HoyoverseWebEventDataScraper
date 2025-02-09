const STATUS_DIV = document.getElementById('status');
const VUE_CDNS = [
    'https://unpkg.com/vue@2.7.14/dist/vue.runtime.min.js',
    'https://cdn.jsdelivr.net/npm/vue@2.7.14/dist/vue.runtime.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/vue/2.7.14/vue.runtime.min.js',
];

/**
 * Updates the status message in the UI
 * @param {string} message - Status message to display
 */
const updateStatus = function(message) {
    STATUS_DIV.textContent = message;
}

/**
 * Extracts file extension from URL or data URI
 * @param {string} url - URL or data URI to process
 * @returns {string} File extension
 */
const getExtensionName = function(url) {
    if (url.indexOf('data:') === 0) {
        const mime = url.match(/data:([^;]+)/)[1];
        return mime.split('/')[1];
    }
    return url.split('.').pop();
}

/**
 * Extracts filename from URL
 * @param {string} url - URL to process
 * @returns {string} Filename without path
 */
const getBaseUrl = function(url) {
    if (url.indexOf('data:') === 0) {
        return '';
    }
    return url.split('/').pop();
}

/**
 * Extracts spine resources from webpack modules
 * @param {Object} modules - Webpack modules
 * @param {string} url - Base URL
 * @param {Window} window - Window object
 * @returns {Object} Extracted spine and main manifests
 */
const extractSpineResources = function(modules, url = '', window = window) {
   const topLevelModules = [];
   const spineManifests = [];
   const mainManifests = [];

   // Find top-level modules by checking for atlas and json string markers
   Object.keys(modules).forEach((moduleKey) => {
       const module = modules[moduleKey];
       const moduleText = module.toString();
       if (moduleText.includes('atlas:') && moduleText.includes('json:')) {
           topLevelModules.push(moduleKey);
       }
   });

   updateStatus('Located top level modules, moving on to sub-level modules.');

   // Set up custom webpack require and override defineProperty to track sub-modules
   const webpackRequire = createWebpackRequire(modules, url);
   const subModules = [];
   window.Object._defineProperty = Object.defineProperty;
   window.Object.defineProperty = (module, property, value) => {
       if (property === '__esModule') {
           subModules.push(module);
       }
       return window.Object._defineProperty(module, property, value);
   };

   const globalThis = window;
   const loadedModules = topLevelModules.map((moduleKey) => webpackRequire(moduleKey));
   window.Object.defineProperty = Object._defineProperty;

   updateStatus('Located sub level modules, moving on to manifest extraction.');

   // Validates and categorizes manifests as either spine or main manifests
   const validateManifest = (manifest, moduleName) => {
       const firstKey = Array.isArray(manifest) ? 0 : Object.keys(manifest)[0];
       let value = manifest[firstKey];
       
       if (!value) return;
       if (typeof value !== 'object') {
           value = manifest;
       }

       // Check for spine manifest (contains atlas and json)
       if (value.atlas && value.json) {
           spineManifests.push(manifest);
           Object.values(manifest).forEach((item) => {
               item.module = moduleName || item.module || '';
           });
           return;
       }

       // Check for main manifest (contains id, src, and type)
       if (value.id && value.src && value.type) {
           mainManifests.push(manifest);
           manifest.forEach((item) => {
               item.module = moduleName || item.module || '';
           });
       }
   };

   // Process sub-modules to extract manifests
   subModules.forEach((subModule) => {
       const moduleKeys = Object.keys(subModule);
       moduleKeys.forEach((key) => {
           if (key.includes && key.includes('_MANIFEST')) {
               const manifestObj = subModule[key];
               const manifestName = key.replace('_MANIFEST', '');
               
               if (Array.isArray(manifestObj)) {
                   validateManifest(manifestObj, '_' + manifestName);
               } else if (Object.values(manifestObj)[0].atlas) {
                   validateManifest(manifestObj, manifestName);
               } else {
                   Object.values(manifestObj).forEach((item) => 
                       validateManifest(item, manifestName)
                   );
               }
           }
       });
   });

   // Remove duplicate entries from main manifest, prioritizing non-underscore modules
   let mainManifestArray = mainManifests.reduce((acc, curr) => curr.concat(acc), []);
   mainManifestArray = mainManifestArray.filter((item) => {
       if (mainManifestArray.find((prev) => item.src === prev.src) && 
           item.module.startsWith('_')) {
           return false;
       }
       return true;
   });

   updateStatus('Manifest extraction complete!');
   
   return {
       SPINE_MANIFEST: spineManifests.reduce((acc, curr) => Object.assign(curr, acc), {}),
       MAIN_MANIFEST: mainManifestArray,
   };
}

/**
 * Extracts the static resources from webpack modules
 * @param {Object} modules - Webpack modules
 * @param {string} url - Base URL
 * @returns {Array} Array of static file objects
 */
const extractStaticResources = function(modules, url) {
   const staticFiles = [];

   updateStatus('Extracting static files...');

   // Extract static file URLs from module exports
   Object.keys(modules).forEach((moduleKey) => {
       const module = modules[moduleKey];
       const moduleText = module.toString();
       const exportMatch = moduleText.match(/[a-zA-Z0-9]\.exports\s?=\s?([a-zA-Z0-9]\.[a-zA-Z0-9]\s?\+)?\s?"(.*?)"/);

       if (!exportMatch) return;

       const fileUrl = exportMatch[2];
       const hasConcatenation = exportMatch[1];

       // Skip non-data URLs without concatenation
       if (!fileUrl.startsWith('data:') && !hasConcatenation) {
           return;
       }

       // Generate file ID from URL getBaseUrl or module key
       let fileId = getBaseUrl(fileUrl);
       if (fileId) {
           const nameParts = fileId.split('.');
           nameParts.pop(); // Remove extension
           if (nameParts.length >= 2) {
               nameParts.pop(); // Remove webpack hash
           }
           fileId = nameParts.join('.');
       } else {
           fileId = moduleKey.replace(/[\/\.\:\+]/g, '_');
       }

       staticFiles.push({
           id: fileId,
           src: fileUrl.includes('data:') ? fileUrl : new URL(fileUrl, url).toString(),
           _module: moduleKey,
       });
   });

    updateStatus('Static file extraction complete!');

   return staticFiles;
}

/**
 * Generates a ZIP file containing spine animations and related resources
 * @param {string} sourceUrl - Source URL containing event ID
 * @param {Object} spineData - Object containing spine manifests and resources
 * @param {Object} staticData - Array of static resources to include
 */
const generateZip = async function(sourceUrl, spineData, staticData) {
    const zipArchive = new JSZip();
    const eventId = extractEventId(sourceUrl);
    
    await addSpineResources(zipArchive, spineData.SPINE_MANIFEST);
    const processedUrls = await addMainResources(zipArchive, spineData.MAIN_MANIFEST);
    await addStaticResources(zipArchive, staticData, processedUrls);
    
    await downloadZipFile(zipArchive, eventId);
};

/**
 * Extracts event ID from URL or generates timestamp
 * @param {string} sourceUrl - Source URL
 * @returns {string} Event ID or timestamp
 */
const extractEventId = (sourceUrl) => {
    return (sourceUrl.match(/event\/(.*?)\//) || ['', ''])[1].split('-')[0] || Date.now().toString();
};

/**
 * Adds spine resources to a given ZIP archive
 * @param {JSZip} zipArchive - ZIP archive instance
 * @param {Object} spineManifest - Spine manifest data
 * @returns {Promise<void>}
 */
const addSpineResources = async function(zipArchive, spineManifest) {
    for (const resourceId of Object.keys(spineManifest)) {
        const resourceData = spineManifest[resourceId];
        const resourceDir = resourceData.module || '';
        
        // Add atlas file
        zipArchive.file(`${resourceDir}/${resourceId}.atlas`, resourceData.atlas);
        
        // Add JSON file - either fetch from URL or use provided data
        if (typeof resourceData.json === 'string' && resourceData.json.startsWith('http')) {
            const response = await fetch(resourceData.json);
            const jsonBlob = await response.blob();
            zipArchive.file(`${resourceDir}/${resourceId}.json`, jsonBlob);
        } else {
            const formattedJson = JSON.stringify(resourceData.json, null, 4);
            zipArchive.file(`${resourceDir}/${resourceId}.json`, formattedJson);
        }
    }
}

/**
 * Adds main manifest resources to ZIP archive
 * @param {JSZip} zipArchive - ZIP archive instance
 * @param {Object} mainManifest - Main manifest data
 * @returns {Promise<Set>} Set of processed URLs
 */
const addMainResources = async function(zipArchive, mainManifest) {
    const processedUrls = new Set();
    
    await Promise.all(Object.values(mainManifest).map(async (resource) => {
        if (processedUrls.has(resource.src)) return;
        
        const resourceDir = resource.module || '';
        const filename = `${resourceDir}/${resource.id}.${getExtensionName(resource.src)}`;
        processedUrls.add(resource.src);
        
        const response = await fetch(resource.src);
        const resourceBlob = await response.blob();
        zipArchive.file(filename, resourceBlob);
    }));
    
    return processedUrls;
}

/**
 * Adds static resources to ZIP archive
 * @param {JSZip} zipArchive - ZIP archive instance
 * @param {Array} staticData - Static resource data
 * @param {Set} processedUrls - Set of already processed URLs
 * @returns {Promise<void>}
 */
const addStaticResources = async function(zipArchive, staticData, processedUrls) {
    await Promise.all(staticData.map(async (resource) => {
        if (processedUrls.has(resource.src)) return;
        
        const filename = `other_resources/${resource.id}.${getExtensionName(resource.src)}`;
        processedUrls.add(resource.src);
        
        const response = await fetch(resource.src);
        const resourceBlob = await response.blob();
        zipArchive.file(filename, resourceBlob);
    }));
}

/**
 * Generates and triggers download of ZIP file
 * @param {JSZip} zipArchive - ZIP archive instance
 * @param {string} eventId - Event identifier
 * @returns {Promise<void>}
 */
const downloadZipFile = async function(zipArchive, eventId) {
    updateStatus("Download starting, please wait...");

    const zipContent = await zipArchive.generateAsync({type: 'blob'});
    const downloadUrl = URL.createObjectURL(zipContent);
    
    const downloadLink = document.createElement('a');
    downloadLink.href = downloadUrl;
    downloadLink.download = `${eventId}.zip`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(downloadUrl);
}

/**
 * Creates the custom webpack require function to be injected into the page
 * @param {Object} modules - Webpack modules
 * @param {string} base - Base URL
 * @returns {Function} Webpack require function
 */
const createWebpackRequire = function(modules, base = '') {
    const installedModules = {};
    
    function __webpack_require__(moduleId) {
        // If the module is already loaded, there's no need to load it again
        if (installedModules[moduleId]) return installedModules[moduleId].exports;

        // Create a new module and store it in the installedModules object
        var module = (installedModules[moduleId] = {
            exports: {},
            id: moduleId,
            loaded: false,
        });

        // Check if the module exists in the modules object
        if (!modules[moduleId]) return '';

        let moduleFunction = modules[moduleId];
        moduleFunction.call(module.exports, module, module.exports, __webpack_require__);
        module.loaded = true;
        return module.exports;
    }

    // Add webpack utility functions
    __webpack_require__.r = function (exports) {
        if (typeof Symbol !== 'undefined' && Symbol.toStringTag) {
            Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
        }
        Object.defineProperty(exports, '__esModule', { value: true });
    };

    __webpack_require__.o = function (object, property) {
        return Object.prototype.hasOwnProperty.call(object, property);
    };

    __webpack_require__.d = function (exports, name, getter) {
        if (!getter) {
            const definition = name;
            for (var key in definition) {
                if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
                    Object.defineProperty(exports, key, {
                        enumerable: true,
                        get: definition[key],
                    });
                }
            }
            return;
        }
        if (!__webpack_require__.o(exports, name)) {
            Object.defineProperty(exports, name, { enumerable: true, get: getter });
        }
    };

    __webpack_require__.c = installedModules;
    __webpack_require__.p = base;
    return __webpack_require__;
}


/**
 * Loads page content in an iframe with enhanced script handling
 * @param {string} url - URL to load
 * @returns {Promise<Object>} Object containing iframe, base URL, and content window
 */
const loadPageInIframe = async function(url) {
    updateStatus('Fetching page content...');
    
    const response = await fetch(url);
    let html = await response.text();

    // Enhanced script injection code with CDN fallbacks and better error handling
    const scriptInjectionCode = `
    <script>
    (function() {
        // Enhanced loadExternalScript function with CDN fallbacks
        window.loadExternalScript = async function(urls) {
            if (typeof urls === 'string') {
                urls = [urls];
            }
            
            for (const url of urls) {
                try {
                    const script = await new Promise((resolve, reject) => {
                        const scriptElem = document.createElement('script');
                        scriptElem.src = url;
                        scriptElem.crossOrigin = "anonymous";
                        scriptElem.onload = () => resolve(scriptElem);
                        scriptElem.onerror = () => reject(new Error(\`Failed to load \${url}\`));
                        document.head.appendChild(scriptElem);
                    });
                    console.log(\`Successfully loaded script from \${url}\`);
                    return script;
                } catch (error) {
                    console.warn(\`Failed to load script from \${url}\`, error);
                    continue;
                }
            }
            throw new Error('All CDN attempts failed');
        };

        // Modified Vue loading logic with fallbacks
        window.vueLoaded = (async function() {
            for (const cdn of ${JSON.stringify(VUE_CDNS)}) {
                try {
                    await window.loadExternalScript(cdn);
                    console.info('Vue loaded successfully from injected script');
                    window.scriptsLoaded = true;
                    return true;
                } catch (error) {
                    console.warn(\`Failed to load Vue from \${cdn}\`);
                    continue;
                }
            }
            console.error('Failed to load Vue from all CDNs');
            return false;
        })();

        // Setup webpack module capture
        window.webpackJsonp_ = [];
        window.cachedModules = [];
        window.loadedModules = [];
        window.webpackJsonpProxy = new Proxy(webpackJsonp_, {
            get: (target, prop) => {
                if (prop === 'push') {
                    return (...args) => {
                        console.log('Captured webpack module:', args);
                        cachedModules.push(...args);
                    };
                }
                return target[prop];
            },
            set: (target, prop, value) => {
                if (prop === 'push') {
                    value(['inject',{
                        inject(module, exports, __webpack_require__){
                            loadedModules = __webpack_require__.m
                        }
                    },[['inject']]])
                    return true;
                }
                target[prop] = value;
                return true;
            },
        });
    })();
    </script>`;

    // Modify HTML with our injected code
    html = html.replace('<head>', `<head>${scriptInjectionCode}`);

    updateStatus('Processing page scripts...');
    
    // Find webpack entry point and process scripts
    let entrName = '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const scripts = doc.querySelectorAll('script');

    scripts.forEach((s) => {
        if (s.src.includes('sentry') || s.textContent.includes('Sentry') || 
            s.textContent.includes('firebase')) {
            s.type = 'text/dontexecute';
        }
        
        // Remove existing Vue scripts if found, as these will cause CORs issues
        if (s.src.includes('https://webstatic.hoyoverse.com/dora/lib/vue')) {
          console.warn(`Found existing Vue load: ${s.src}, attempting to remove...`);
          s.remove();
        }
        
        if (s.textContent.includes('Symbol.toStringTag') && 
            s.textContent.includes('Object.defineProperty')) {
            s.type = 'text/dontexecute';
            const matches = [...s.textContent.matchAll(/self\.(.*?)=self.(.*?)\|\|\[\]/g)];
            for (const match of matches) {
                if (match[1] === match[2]) {
                    if (entrName !== '') {
                        console.warn(`Multiple entry points found: ${entrName} and ${match[1]}`);
                    }
                    entrName = match[1];
                }
            }
        }
    });

    html = doc.documentElement.outerHTML;

    // Handle base URL
    let base = url;
    const matchVendors = html.match(/src="([^"]*?\/)vendors([^"]*?)js"/);
    if (matchVendors) {
        base = matchVendors[1];
    }
    if (!base.includes('://')) {
        base = new URL(base, url).toString();
    }

    html = html.replace('<head>', `<head><base href="${base}">`);

    updateStatus('Loading page in iframe...');

    // Create and load iframe
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.srcdoc = html;
    document.getElementById('content').appendChild(iframe);

    return new Promise((resolve, reject) => {
        iframe.onload = () => {
            updateStatus('Waiting for scripts to load...');
            
            // Enhanced script loading with better error handling
            setTimeout(async () => {
                try {
                    const vueLoaded = await iframe.contentWindow.vueLoaded;
                    if (!vueLoaded) {
                        updateStatus('Warning: Vue failed to load from all CDNs. Everything will likely break from here out.');
                    } else {
                        updateStatus('Page loaded successfully!');
                    }
                    resolve({ 
                        iframe, 
                        base,
                        contentWindow: iframe.contentWindow
                    });
                } catch (error) {
                    console.error('Error during Vue initialization:', error);
                    updateStatus('Error during Vue initialization. Some features may not work.');
                    resolve({ 
                        iframe, 
                        base,
                        contentWindow: iframe.contentWindow
                    });
                }
            }, 2000);
        };

        iframe.onerror = (error) => {
            updateStatus(`Error loading page due to the following error: ${error.message}`);
            reject(error);
        };
    });
}

// Set up form submission handler
document.getElementById('url-form').addEventListener('submit', async function(event) {
    event.preventDefault();
    const url = document.getElementById('url-input').value;
    let spineData = {};
    let staticData = {};
    
    // Validate URL
    if (!url.startsWith('https://act.hoyoverse.com/') && !url.startsWith('https://webstatic-sea.mihoyo.com/')) {
        updateStatus('Invalid URL. Please provide a valid event URL (i.e. starting with act.hoyoverse.com or webstatic-sea.mihoyo.com)');
        return;
    }

    try {
        // Clear any existing iframes
        document.getElementById('clear').click();

        // Extract the name of the event from the URL
        const EVENT_MATCH = url.match(/\/e(\d+[a-zA-Z]+)(?:-|\/)/);
        if (!EVENT_MATCH) {
            alert('Failed to extract event ID from URL. Please check the URL and try again.');
            return;
        }
        const EVENT_NAME = EVENT_MATCH[1];
        const WEBPACK_CHUNK_NAME = `webpackChunk${EVENT_NAME}`;
        
        // Load the page and extract data
        const { iframe, base, contentWindow } = await loadPageInIframe(url);
        iframe.contentWindow.regeneratorRuntime = regeneratorRuntime; 

        console.log(iframe.contentWindow);
        
        // Add extraction complete message
        updateStatus('Page loaded and relevant scripts injected successfully - now pending analysis.');
        
        // Display the iframe and status message
        iframe.style.display = 'block';

        // Check if there are any modules in the cachedModule array
        let modules = {};  
        updateStatus("Checking for modules");

        // Check if there are any modules in the cachedModule array, if so, set the modules to the cachedModules
        if (iframe.contentWindow.cachedModules && iframe.contentWindow.cachedModules.length > 0) {
            modules = {
                ...iframe.contentWindow.loadedModules,
            };
            for (const i of iframe.contentWindow.cachedModules) {
                modules = {
                    ...modules,
                    ...i[1],
                };
            }
            updateStatus("Modules located in page's cached modules, moving on.");

        // If there are no modules, check if there is a relevant webpack array (i.e. webpackChunk<eventname>)
        } else {
            // Create a function to safely check and access the webpack chunk
            const getWebpackChunk = () => {
                // Get all properties of the contentWindow
                const props = Object.getOwnPropertyNames(iframe.contentWindow);
                // Find the property that starts with 'webpackChunk' and contains our event name
                const webpackProp = props.find(prop => 
                    prop.startsWith('webpackChunk') && prop.includes(EVENT_NAME)
                );
                return webpackProp ? iframe.contentWindow[webpackProp] : null;
            };

            const webpackChunk = getWebpackChunk();

            if (!webpackChunk || !webpackChunk.length) {
                updateStatus('No modules found in the provided page!');
                return;
            }

            const [testVendors, testIndex, testRuntime] = webpackChunk;

            // Ensure that the webpack chunk contains the necessary modules
            if (!testVendors) {
                updateStatus('webpack chunk - load vendors.js failed!');
                return;
            }

            if (!testIndex) {
                updateStatus('webpack chunk - load index.js failed!');
                return;
            }

            modules = { 
                ...testVendors[1], 
                ...testIndex[1], 
                ...(testRuntime ? testRuntime[1] : {}) 
            };

            updateStatus("Modules located in webpack chunk, moving on.");
        }

        // Try get the spine and static data
        try {
            spineData = extractSpineResources(modules, base, contentWindow);
            staticData = extractStaticResources(modules, base, contentWindow);
        } catch (error) {
            console.error('Error during data extraction:', error);
            updateStatus('Error during data extraction. Please check the console for details.');
            return;
        }

        updateStatus("Data extraction complete, generating download. Please wait as this can take some time.")

        // Generate the zip file
        generateZip(url, spineData, staticData);

    } catch (error) {
        console.error('Error during page loading:', error);
        alert('An error occurred while loading the page. Please check the console for details.');
    }
});

// Set up clear button listener
document.getElementById('clear').addEventListener('click', function() {
    // Remove iframes
    const iframes = document.getElementsByTagName('iframe');
    while (iframes.length > 0) {
        iframes[0].remove();
    }
    
    // Remove status messages
    STATUS_DIV.textContent = '';
    
    // Clear console
    console.clear();
});