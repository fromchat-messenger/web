import { defineConfig, PluginOption } from "vite";
import { createHtmlPlugin } from "vite-plugin-html";
import autoprefixer from "autoprefixer";
import react from "@vitejs/plugin-react";
import path from "path";
import { visualizer } from 'rollup-plugin-visualizer';
import sassDts from 'vite-plugin-sass-dts';
import { optimizeCssModules } from './plugins/optimizeCssModules';
import { optimizeSvg } from './plugins/optimizeSvg';

const currentDir = path.resolve(__dirname);
const outDir = `${currentDir}/build/normal`;

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

export default defineConfig({
    root: path.resolve(__dirname, "src"),
    envDir: currentDir,
    plugins: plugins,
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src/main"),
            "@fromchat/protocol": path.resolve(__dirname, "./src/protocol/index.ts")
        }
    },
    server: {
        host: '0.0.0.0',
        port: 8301,
        strictPort: true,
        allowedHosts: ["beta.fromchat.ru"]
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
