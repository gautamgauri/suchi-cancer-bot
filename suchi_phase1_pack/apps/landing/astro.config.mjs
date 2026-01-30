// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site: 'https://gautamgauri.github.io',
  base: '/suchi-cancer-bot/',
  trailingSlash: 'always',
  build: {
    assets: '_assets'
  }
});
