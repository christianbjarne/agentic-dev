//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import react from '@vitejs/plugin-react-swc';
import { rayfinLocalDev } from '@microsoft/rayfin-local-dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type PluginOption } from 'vite';
import license from 'rollup-plugin-license';

import { resolve } from 'path';

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname;

// Dev-only middleware: makes the local Vite server compatible with browsers that
// enforce Local Network Access (LNA) checks when a public origin (the Fabric portal)
// embeds an iframe pointing at http://localhost. Sets the LNA opt-in response header
// on every response and short-circuits the corresponding preflight OPTIONS request.
// This is required for fetch/XHR subresources from the embedded app — top-level
// iframe navigations additionally require launching Chromium with the
// `--disable-features=...LocalNetworkAccessChecks` flag (a browser flag your test tooling must set).
const localNetworkAccessPlugin: PluginOption = {
  name: 'local-network-access-headers',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (
        req.method === 'OPTIONS' &&
        req.headers['access-control-request-private-network']
      ) {
        const origin = req.headers.origin || '*';
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          req.headers['access-control-request-headers'] || '*'
        );
        res.statusCode = 204;
        res.end();
        return;
      }
      next();
    });
  },
};

// Opt-in (RAYFIN_REMOTE_FUNCTIONS=1): run only the frontend locally and send
// `/functions/<name>/invoke` to the deployed backend instead of a local
// Functions host. The session cookie/bearer is added by the SDK as usual.
const remoteFunctionsPlugin: PluginOption = {
  name: 'rayfin-remote-functions',
  apply: 'serve',
  config(_config, env) {
    if (process.env.RAYFIN_REMOTE_FUNCTIONS !== '1') return undefined;
    const apiUrl = loadEnv(env.mode, projectRoot, 'VITE_').VITE_RAYFIN_API_URL;
    if (!apiUrl) return undefined;
    const target = new URL(apiUrl);
    const basePath = target.pathname.replace(/\/+$/, '');
    return {
      server: {
        proxy: {
          '^/functions/': {
            target: target.origin,
            changeOrigin: true,
            rewrite: (path: string) => `${basePath}${path}`,
          },
        },
      },
    };
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    rayfinLocalDev({ autoLogin: true, sourceActivity: true }),
    remoteFunctionsPlugin,
    localNetworkAccessPlugin,
  ],
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src'),
    },
    // Capability packages are linked during monorepo development. Force their
    // React imports onto the app's instance so production builds cannot bundle
    // a second dispatcher and fail hooks at runtime.
    dedupe: ['react', 'react-dom'],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/],
    },
    rollupOptions: {
      plugins: [
        license({
          thirdParty: {
            multipleVersions: true,
            output: {
              file: resolve(projectRoot, 'dist', 'THIRD_PARTY_NOTICES.txt'),
              template(dependencies) {
                if (dependencies.length === 0) {
                  return 'No third-party dependencies.';
                }
                return (
                  'This file was auto-generated at build time.\n\n' +
                  dependencies
                    .map((dep) => {
                      const lines = [
                        `${dep.name}@${dep.version}`,
                        `License: ${dep.license || 'UNKNOWN'}`,
                      ];
                      if (dep.author) {
                        lines.push(
                          `Author: ${typeof dep.author === 'string' ? dep.author : dep.author.text()}`
                        );
                      }
                      if (dep.noticeText) {
                        lines.push('', 'NOTICE:', dep.noticeText.trim());
                      }
                      if (dep.licenseText) {
                        lines.push('', dep.licenseText.trim());
                      }
                      return lines.join('\n');
                    })
                    .join('\n\n' + '='.repeat(60) + '\n\n')
                );
              },
            },
          },
        }),
      ],
    },
  },
});
