// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site: 'https://suchitracancercare.org',
  base: '/',
  trailingSlash: 'always',
  build: {
    assets: '_assets'
  }
});
