// Constants and other helper functions 
const STATUS_DIV = document.getElementById('status');
const vueCDNs = [
    'https://unpkg.com/vue@2.7.14/dist/vue.runtime.min.js',
    'https://cdn.jsdelivr.net/npm/vue@2.7.14/dist/vue.runtime.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/vue/2.7.14/vue.runtime.min.js',
];

const updateStatus = function(message) {
    STATUS_DIV.textContent = message;
}

const extname = function(url) {
    if (url.indexOf('data:') === 0) {
        const mime = url.match(/data:([^;]+)/)[1];
        return mime.split('/')[1];
    }
    return url.split('.').pop();
}

const basename = function(url) {
    if (url.indexOf('data:') === 0) {
        return '';
    }
    return url.split('/').pop();
}

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

       // Generate file ID from URL basename or module key
       let fileId = basename(fileUrl);
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

const generateZip = async function(url, spineData, staticData) {
    const zip = new JSZip();
    const eventFolderName = (url.match(/event\/(.*?)\//) || ['', ''])[1].split('-')[0] || Date.now().toString();
    
    for (const i of Object.keys(spineData.SPINE_MANIFEST)) {
        const dir = spineData.SPINE_MANIFEST[i].module || '';
        const atlas = spineData.SPINE_MANIFEST[i].atlas;
        zip.file(dir + '/' + i + '.atlas', atlas);
        
        const j = spineData.SPINE_MANIFEST[i].json;
        if (typeof j === 'string' && j.indexOf('http') === 0) {
            const response = await fetch(j);
            const blob = await response.blob();
            zip.file(dir + '/' + i + '.json', blob);
        } else {
            zip.file(dir + '/' + i + '.json', JSON.stringify(j, null, 4));
        }
    }

    // Save images
    const savedIds = new Set();
    const fetchPromises = Object.values(spineData.MAIN_MANIFEST).map(async (e) => {
        if (savedIds.has(e.src)) return;
        
        const dir = e.module || '';
        const filename = dir + '/' + e.id + '.' + extname(e.src);
        savedIds.add(e.src);
        
        const response = await fetch(e.src);
        const blob = await response.blob();
        zip.file(filename, blob);
    });

    // Save static resources
    const staticPromises = staticData.map(async (e) => {
        if (savedIds.has(e.src)) return;
        
        const dir = 'other_resources';
        const filename = dir + '/' + e.id + '.' + extname(e.src);
        savedIds.add(e.src);
        
        const response = await fetch(e.src);
        const blob = await response.blob();
        zip.file(filename, blob);
    });

    await Promise.all([...fetchPromises, ...staticPromises]);
    
    // Generate and download zip
    const content = await zip.generateAsync({type: 'blob'});
    const downloadUrl = URL.createObjectURL(content);
    
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fetchToZip + '.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
}

// Create the custom webpack require function
function createWebpackRequire(modules, base = '') {
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

// Enhanced iframe loading function with improved script handling
async function loadPageInIframe(url) {
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
            for (const cdn of ${JSON.stringify(vueCDNs)}) {
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
    if (!url.startsWith('https://act.hoyoverse.com/')) {
        alert('Please enter a valid act.hoyoverse.com URL.');
        return;
    }

    try {
        // Clear any existing iframes
        document.getElementById('clear').click();
        
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
        // If there are no modules, check if there is a webpackChunke20250124year array
        } else if (iframe.contentWindow.webpackChunke20250124year && iframe.contentWindow.webpackChunke20250124year.length > 0) {
            const test = iframe.contentWindow.webpackChunke20250124year;
            console.log('found webpackChunke20250124year', test);
            const testVendors = test[0];
            if (!testVendors) {
                updateStatus('webpackChunke20250124year - load vendors.js failed!');
                return;
            }
            const testIndex = test[1];
            if (!testIndex) {
                updateStatus('webpackChunke20250124year - load index.js failed!');
                return;
            }
            const testRuntime = test[2];
            modules = { ...testVendors[1], ...testIndex[1], ...(testRuntime ? testRuntime[1] : {}) };
        }
        // If there are no modules, error out 
        else {
            updateStatus('No modules found in the page!');
            return;
        }
        updateStatus("Modules located (or at least didn't error out), moving on.");

        // Try get the spine and static data
        try {
            spineData = extractSpineResources(modules, base, contentWindow);
            staticData = extractStaticResources(modules, base, contentWindow);
        } catch (error) {
            console.error('Error during data extraction:', error);
            updateStatus('Error during data extraction. Please check the console for details.');
            return;
        }

        // Generate the zip file
        generateZip(url, spineData, staticData);


    } catch (error) {
        console.error('Error during page loading:', error);
        alert('An error occurred while loading the page. Please check the console for details.');
    }
});

// Clear button listener
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