import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import type { ForgeConfig } from '@electron-forge/shared-types';

export default {
    packagerConfig: {
        asar: true,
    },
    outDir: "build/electron/forge",
    rebuildConfig: {},
    makers: [
        {
            name: '@electron-forge/maker-zip',
            config: {},
            platforms: ['win32', 'darwin'],
        },
        {
            name: '@electron-forge/maker-deb',
            config: {},
            platforms: ['linux'],
        },
        {
            name: '@electron-forge/maker-rpm',
            config: {},
            platforms: ['linux'],
        },
    ],
    plugins: [
        {
            name: '@electron-forge/plugin-auto-unpack-natives',
            config: {},
        },
        // Fuses are used to enable/disable various Electron functionality
        // at package time, before code signing the application
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
        }),
    ],
} satisfies ForgeConfig;