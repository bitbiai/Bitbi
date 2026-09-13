const base = require('./playwright.config.js');
module.exports = {
 ...base, webServer:{...base.webServer,reuseExistingServer:false}, retries:0, workers:1,
 outputDir:'test-results/model-status-artifacts',
 projects:['chromium','webkit'].map(browserName=>({name:`${browserName}-status`,testMatch:['**/oma2-q3-model-status.spec.js'],use:{browserName,hasTouch:true}})),
};
