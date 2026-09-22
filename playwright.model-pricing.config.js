const base = require('./playwright.config.js');
const imageModels = process.env.CI_IMAGE_MODELS === 'true';
const appearance = process.env.CI_APPEARANCE === 'true';
const files = ['oma2-q3-model-pricing.spec.js',
 ...(imageModels ? ['auth-admin.spec.js','smoke.spec.js','canvas.spec.js'] : []),
 ...(appearance ? ['oma2-q3-appearance.spec.js','auth-admin.spec.js'] : [])];
const names = ['oma2-q3-model-pricing\\.spec\\.js',
 ...(imageModels ? ['GPT Image 2'] : []),
 ...(appearance ? ['oma2-q3-appearance\\.spec\\.js','cold workspace exposes grouped tasks'] : [])];
module.exports = {
 ...base, webServer:{...base.webServer,reuseExistingServer:false}, retries:0, workers:1,
 outputDir:'test-results/model-pricing-artifacts',
 projects:['chromium','webkit'].map(browserName=>({name:`${browserName}-pricing`,testMatch:[...new Set(files)].map(file=>'**/'+file),grep:new RegExp(names.join('|')),use:{browserName}})),
};
