const base = require('./playwright.config.js');
module.exports = {
 ...base, webServer:{...base.webServer,reuseExistingServer:false}, retries:0, workers:1,
 outputDir:'test-results/model-pricing-artifacts',
 projects:['chromium','webkit'].map(browserName=>({name:`${browserName}-pricing`,testMatch:['**/oma2-q3-model-pricing.spec.js'],use:{browserName}})),
};
