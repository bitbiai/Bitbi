const base = require('./playwright.config.js');

// Existing shared cards plus owner action/picker and durable-client neighbors.
const scopes = [
  {name:'cards',testMatch:['**/assets-manager-focused.spec.js']},
  {name:'jobs',testMatch:['**/oma2-q1-member.spec.js'],grep:/durable generation/},
  {name:'actions',testMatch:['**/auth-admin.spec.js','**/locale.spec.js'],grep:/account Assets Manager (gates rename|lets the owner publish|supports moving)|saved assets picker stays image-only|mobile Assets Manager keeps compact storage|German mobile account Assets Manager localizes|member workspace navigation keeps English and German routes equivalent/},
];
module.exports = {
  ...base, retries:0, outputDir:'test-results/asset-artifacts',
  projects:['chromium','webkit'].flatMap(browserName=>scopes.map(scope=>({
    ...scope,name:`${browserName}-${scope.name}`,use:{browserName},
  }))),
};
