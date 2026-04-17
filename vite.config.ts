import devtoolsJson from 'vite-plugin-devtools-json';
import ggPlugins from '@leftium/gg/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit(), devtoolsJson(), ...ggPlugins({ fileSink: true })]
});
