import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		allowedHosts: ['sch.shtelo.org', 'localhost'],
		https: (() => {
			const keyPath = path.resolve(__dirname, '../server/key.pem');
			const certPath = path.resolve(__dirname, '../server/cert.pem');
			try {
				if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
					return {
						key: fs.readFileSync(keyPath),
						cert: fs.readFileSync(certPath)
					};
				}
			} catch {}
			return undefined;
		})(),
		host: 'localhost',
		port: 5173
	}
});
