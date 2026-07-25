// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    // Gives `astro dev` the real Workers bindings (AI, vars, secrets) from
    // wrangler.jsonc and .dev.vars, so local behaviour matches deployed.
    platformProxy: { enabled: true },
  }),
});
