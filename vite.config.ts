import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

import { viteStaticCopy } from 'vite-plugin-static-copy';
import viteCompression from 'vite-plugin-compression';

// /** @type {import('vite').Plugin} */
// const viteServerConfig = {
// 	name: 'log-request-middleware',
// 	configureServer(server) {
// 		server.middlewares.use((req, res, next) => {
// 			res.setHeader('Access-Control-Allow-Origin', '*');
// 			res.setHeader('Access-Control-Allow-Methods', 'GET');
// 			res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
// 			res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
// 			next();
// 		});
// 	}
// };

export default defineConfig({
	plugins: [
		sveltekit(),
		viteStaticCopy({
			targets: [
				{
					src: 'node_modules/onnxruntime-web/dist/*.jsep.*',
					dest: 'wasm'
				}
			]
		}),
		viteCompression({
			filter: /\.(js|css|txt|html|ico|svg)(\?.*)?$/i, // 需要压缩的文件
			verbose: true, // 是否在控制台输出压缩结果
			disable: false, // 默认 false, 设置为 true 来禁用压缩
			threshold: 1024 * 5, // 只处理大于此大小的资源（单位：b）。默认值为 0。
			algorithm: "gzip", // 使用 gzip 压缩
			ext: ".gz", // 输出文件的扩展名
			deleteOriginFile: false,
		})
	],
	define: {
		APP_VERSION: JSON.stringify(process.env.npm_package_version),
		APP_BUILD_HASH: JSON.stringify(process.env.APP_BUILD_HASH || 'dev-build')
	},
	build: {
		sourcemap: false,
		assetsInlineLimit: 1024 * 5, // 小于此阈值的导入或引用资源将内联为 base64 编码，以避免额外的 http 请求
		minify: "terser",	// 压缩方式
		terserOptions: {
			compress: {
				// 剔除console和debugger
				drop_console: true,
				drop_debugger: true,
			},
			format: {
				comments: false, // 移除注释
			},
		}
	},
	worker: {
		format: 'es'
	}
});
