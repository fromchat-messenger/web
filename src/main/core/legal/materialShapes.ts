/** Material expressive shape SVG paths — generated from Compose MaterialShapes. */

export { MATERIAL_SHAPE_PATHS } from "./materialShapes.generated";

import { MATERIAL_SHAPE_PATHS } from "./materialShapes.generated";

export type MaterialShapeName = keyof typeof MATERIAL_SHAPE_PATHS;

export function getMaterialShapePath(name: string): string {
    return MATERIAL_SHAPE_PATHS[name] ?? MATERIAL_SHAPE_PATHS.Circle;
}

interface PathBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface PathUnitSquareFit {
    transform: string;
}

const pathFitCache = new Map<string, PathUnitSquareFit>();

/**
 * Parses M/L/Z path commands and returns axis-aligned bounds of all vertices.
 * Generated Material shape paths use only these commands.
 */
function computePathBounds(pathD: string): PathBounds {
    const tokens = pathD.trim().match(/[MLZmlz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g);
    if (!tokens?.length) {
        return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let curX = 0;
    let curY = 0;
    let startX = 0;
    let startY = 0;
    let cmd = "";
    let i = 0;

    const extend = (x: number, y: number) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        curX = x;
        curY = y;
    };

    while (i < tokens.length) {
        const token = tokens[i];
        if (/^[A-Za-z]$/.test(token)) {
            cmd = token;
            i++;
            if (cmd === "Z" || cmd === "z") {
                extend(startX, startY);
            }
            continue;
        }

        const x = Number(tokens[i++]);
        const y = Number(tokens[i++]);

        let absX = x;
        let absY = y;
        switch (cmd) {
            case "M":
                absX = x;
                absY = y;
                startX = absX;
                startY = absY;
                cmd = "L";
                break;
            case "m":
                absX = curX + x;
                absY = curY + y;
                startX = absX;
                startY = absY;
                cmd = "l";
                break;
            case "L":
                absX = x;
                absY = y;
                break;
            case "l":
                absX = curX + x;
                absY = curY + y;
                break;
            default:
                continue;
        }
        extend(absX, absY);
    }

    return { minX, minY, maxX, maxY };
}

/**
 * Maps a normalized Material shape path to fill viewBox `0 0 1 1` edge-to-edge.
 */
export function fitPathToUnitSquare(pathD: string): PathUnitSquareFit {
    const cached = pathFitCache.get(pathD);
    if (cached) {
        return cached;
    }

    const { minX, minY, maxX, maxY } = computePathBounds(pathD);
    const width = maxX - minX;
    const height = maxY - minY;

    if (width <= 0 || height <= 0) {
        const fallback = { transform: "" };
        pathFitCache.set(pathD, fallback);
        return fallback;
    }

    const sx = 1 / width;
    const sy = 1 / height;
    const fit: PathUnitSquareFit = {
        transform: `scale(${sx}, ${sy}) translate(${-minX}, ${-minY})`,
    };
    pathFitCache.set(pathD, fit);
    return fit;
}
