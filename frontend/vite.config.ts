import { defineConfig, PluginOption } from "vite";
import { createHtmlPlugin } from "vite-plugin-html";
import autoprefixer from "autoprefixer";
import electron from "vite-plugin-electron/simple";
import react from "@vitejs/plugin-react";
import path from "path";
import { visualizer } from 'rollup-plugin-visualizer';
import sassDts from 'vite-plugin-sass-dts';
import { optimizeCssModules } from './plugins/optimizeCssModules';
import { optimizeSvg } from './plugins/optimizeSvg';

const currentDir = path.resolve(__dirname);
const outDir = process.env.VITE_ELECTRON ? `${currentDir}/build/electron` : `${currentDir}/build/normal`;

const plugins: PluginOption[] = [
    react({
        babel: {
            compact: false
        }
    }),
    sassDts({
        enabledMode: ['development', 'production']
    }),
    optimizeCssModules(),
    optimizeSvg(),
    createHtmlPlugin({
        minify: {
            collapseWhitespace: true,
            removeComments: true,
            removeRedundantAttributes: true,
            removeScriptTypeAttributes: true,
            removeStyleLinkTypeAttributes: true,
            useShortDoctype: true,
            minifyCSS: true,
            minifyJS: true
        }
    }),
    visualizer({
        filename: `${outDir}/stats.html`,
        open: false,
        gzipSize: true
    })
]

if (process.env.VITE_ELECTRON) {
    plugins.push(
        electron({
            main: {
                entry: "electron/main.ts",
                vite: {
                    build: {
                        outDir: `${outDir}/core`
                    }
                }
            },
            preload: {
                input: "frontend/electron/preload.ts",
                vite: {
                    build: {
                        outDir: `${outDir}/core`
                    }
                }
            },
            renderer: {},
        })
    );
}

const _lan = process.env.LAN_IP;
const _backendProxy = _lan ? `http://${_lan}:8300/` : "http://127.0.0.1:8300/";

export default defineConfig({
    plugins: plugins,
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "@fromchat/protocol": path.resolve(__dirname, "./packages/fromchat-protocol/src/index.ts")
        }
    },
    server: {
        host: '0.0.0.0',
        port: 8301,
        strictPort: true,
        proxy: {
            "/api": {
                target: _backendProxy,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ""),
                ws: true
            }
        },
        allowedHosts: [
            "beta.fromchat.ru",
            ...(_lan ? [_lan] : []),
        ]
    },
    appType: "spa",
    optimizeDeps: {
        exclude: ["@fromchat/protocol"],
        esbuildOptions: {
            target: "es2022"
        }
    },
    css: {
        postcss: {
            plugins: [autoprefixer()]
        }
    },
    build: {
        minify: 'terser',
        terserOptions: {
            compress: {
                drop_console: true,
                drop_debugger: true
            },
            format: {
                comments: false
            }
        },
        cssMinify: true,
        assetsInlineLimit: 0,
        outDir: `${outDir}/dist`,
        chunkSizeWarningLimit: 1024
    },
    cacheDir: `${currentDir}/build/cache`
});