// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  // Adapter v14 dropped the `platformProxy` option — `astro dev` now runs the
  // app inside workerd through the Cloudflare Vite plugin, so bindings from
  // wrangler.jsonc and .dev.vars are always real. Passing the old option did
  // nothing but suggest it was doing something.
  adapter: cloudflare(),
});
