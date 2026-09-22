// Retain workerd's real AI binding API while replacing only the external HTTP
// transport with a credential-free provider fixture. A service-RPC substitute
// cannot carry AI.run's AbortSignal under the production compatibility flags.
export const plugins = {
  'q2-image25-ai': {
    getBindings({ config }) {
      return Object.entries(config.env || {}).filter(([, binding]) => binding.type === 'unsafe:q2-image25-ai')
        .map(([name]) => ({ name, wrapped: { moduleName: 'cloudflare-internal:ai-api',
          innerBindings: [{ name: 'fetcher', service: { name: 'core:user:q2-image25-ai' } }] } }));
    },
    getNodeBindings() { return {}; },
    getServices() { return []; },
  },
};
