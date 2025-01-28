// Constants and other helper functions 
const STATUS_DIV = document.getElementById('status');

function updateStatus(message) {
    STATUS_DIV.textContent = message;
}

// Promise rate limiter implementation - keeps us from overwhelming the server
const LimitPromise = function (max) {
    this._max = max;
    this._count = 0;
    this._taskQueue = [];
};

LimitPromise.prototype.call = function (caller, ...args) {
    return new Promise((resolve, reject) => {
        const task = this._createTask(caller, args, resolve, reject);
        if (this._count >= this._max) {
            this._taskQueue.push(task);
        } else {
            task();
        }
    });
};

LimitPromise.prototype._createTask = function (caller, args, resolve, reject) {
    return () => {
        caller(...args)
            .then(resolve)
            .catch(reject)
            .finally(() => {
                this._count--;
                if (this._taskQueue.length) {
                    let task = this._taskQueue.shift();
                    task();
                }
            });
        this._count++;
    };
};

// Initialize our promise limiter
const limitP = new LimitPromise(128);

// Utility functions for handling file paths and extensions
function extname(url) {
    if (url.indexOf('data:') === 0) {
        const mime = url.match(/data:([^;]+)/)[1];
        return mime.split('/')[1];
    }
    return url.split('.').pop();
}

function basename(url) {
    if (url.indexOf('data:') === 0) {
        return '';
    }
    return url.split('/').pop();
}

// Create the custom webpack require function
function createWebpackRequire(modules, base = '') {
    const installedModules = {};
    
    function __webpack_require__(moduleId) {
        if (installedModules[moduleId]) return installedModules[moduleId].exports;
        var module = (installedModules[moduleId] = {
            exports: {},
            id: moduleId,
            loaded: false,
        });
        if (!modules[moduleId]) return '';
        modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
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

// Define CDN fallback options for Vue and other critical dependencies
const vueCDNs = [
    'https://unpkg.com/vue@2.7.14/dist/vue.runtime.min.js',
    'https://cdn.jsdelivr.net/npm/vue@2.7.14/dist/vue.runtime.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/vue/2.7.14/vue.runtime.min.js',
];

// Enhanced script loading function with retry logic
function loadScript(src, retries = 2) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.crossOrigin = "anonymous"; // Add CORS header for cross-origin requests
        
        script.onload = () => {
            console.log(`Successfully loaded script from ${src}`);
            resolve(script);
        };
        
        script.onerror = async (error) => {
            console.warn(`Failed to load script from ${src}`, error);
            if (retries > 0) {
                console.log(`Retrying... ${retries} attempts remaining`);
                try {
                    const result = await loadScript(src, retries - 1);
                    resolve(result);
                } catch (retryError) {
                    reject(retryError);
                }
            } else {
                reject(new Error(`Failed to load script after multiple attempts: ${src}`));
            }
        };
        
        document.head.appendChild(script);
    });
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
        
        // Add extraction complete message
        updateStatus('Page loaded and relevant scripts injected successfully - now pending analysis.');
        
        // Display the iframe and status message
        iframe.style.display = 'block';

        // Check if there are any modules in the cachedModule array
        let modules = {};
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
        // If there are no modules, check if there is a webpackJsonp array
        } else if (iframe.contentWindow.webpackJsonp_ && iframe.contentWindow.webpackJsonp_.length > 0) {
            const webpackJsonp = iframe.contentWindow.webpackJsonp_;
            console.log('found WebpackJsonp', webpackJsonp);
            const vendors = webpackJsonp.find((e) => e[0].includes('vendors'));
            if (!vendors) {
                updateStatus('WebpackJsonp - load vendors.js failed!');
                return;
            }
            const Index = webpackJsonp.find((e) => e[0].includes('index'));
            if (!Index) {
                updateStatus('WebpackJsonp - load index.js failed!');
                return;
            }
            const Runtime = webpackJsonp.find((e) => e[0].includes('runtime'));
            modules = { ...vendors[1], ...Index[1], ...(Runtime ? Runtime[1] : {}) };
        }
        // If there are no modules or a webpackJsonp array, check if there is is any script tags in the content that link to a vendor.js or index.js file
        else {
            const scripts = iframe.contentWindow.document.querySelectorAll('script');
            const vendorScript = Array.from(scripts).find((e) => e.src.includes('vendors'));
            if (!vendorScript) {
                updateStatus('Scripts array - load vendors.js failed!');
                return;
            }
            const indexScript = Array.from(scripts).find((e) => e.src.includes('index'));
            if (!indexScript) {
                updateStatus('Scripts array - load index.js failed!');
                return;
            }
            const runtimeScript = Array.from(scripts).find((e) => e.src.includes('runtime'));
            modules = {
                vendors: vendorScript.src,
                index: indexScript.src,
                runtime: runtimeScript ? runtimeScript.src : null
            };
        }
        console.log('Modules ', modules);

    } catch (error) {
        console.error('Error during page loading:', error);
        alert('An error occurred while loading the page. Please check the console for details.');
    }
});

// Enhanced clear button functionality
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