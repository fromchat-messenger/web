import type { Plugin } from 'vite';
import { optimize } from 'svgo';

export interface OptimizeSvgOptions {
    /**
     * Whether to enable SVG optimization
     * @default true
     */
    enabled?: boolean;
}

const svgoConfig: Parameters<typeof optimize>[1] = {
    multipass: true,
    plugins: [
        {
            name: 'preset-default',
            params: {
                overrides: {
                    // Keep IDs if they might be referenced (minify instead of remove)
                    cleanupIds: {
                        remove: false,
                        minify: true
                    }
                }
            }
        }
    ]
};

/**
 * Optimizes SVG files during build by:
 * - Minifying SVG code
 * - Removing metadata and comments
 * - Removing unnecessary attributes
 * - Optimizing paths and shapes
 */
export function optimizeSvg(options?: OptimizeSvgOptions): Plugin {
    const enabled = options?.enabled !== false;

    return {
        name: 'optimize-svg',
        apply: 'build',
        enforce: 'post',
        async generateBundle(options, bundle) {
            if (!enabled) return;

            // Optimize SVGs in the bundle
            for (const [fileName, chunk] of Object.entries(bundle)) {
                if (fileName.endsWith('.svg') && chunk.type === 'asset') {
                    try {
                        const svgContent = typeof chunk.source === 'string' 
                            ? chunk.source 
                            : Buffer.from(chunk.source).toString('utf-8');
                        
                        const result = optimize(svgContent, svgoConfig);

                        if (result.data && result.data !== svgContent) {
                            chunk.source = result.data;
                        }
                    } catch (error) {
                        console.warn(`Failed to optimize SVG ${fileName}:`, error);
                    }
                }
            }
        }
    };
}
