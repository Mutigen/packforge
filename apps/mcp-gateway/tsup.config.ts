import { defineConfig } from 'tsup'

export default defineConfig([
  // Library entry — importable by other packages
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    splitting: false,
    clean: true,
    dts: true,
    sourcemap: true,
    noExternal: [
      '@hub/context-analyzer',
      '@hub/export-adapters',
      '@hub/memory-service',
      '@hub/orchestrator',
      '@hub/pack-validator',
      '@hub/policy-service',
      '@hub/shared-config',
      '@hub/shared-types',
    ],
    external: [
      '@modelcontextprotocol/sdk',
      '@opentelemetry/api',
      '@opentelemetry/sdk-node',
      'fastify',
      'jose',
      'js-yaml',
      'lru-cache',
      'pino',
      'undici',
      'zod',
    ],
  },
  // CLI entry — executable with shebang
  {
    entry: { cli: 'src/cli.ts' },
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    splitting: false,
    clean: false, // don't wipe the index output
    dts: false,
    sourcemap: true,
    noExternal: [
      '@hub/context-analyzer',
      '@hub/export-adapters',
      '@hub/memory-service',
      '@hub/orchestrator',
      '@hub/pack-validator',
      '@hub/policy-service',
      '@hub/shared-config',
      '@hub/shared-types',
    ],
    external: [
      '@modelcontextprotocol/sdk',
      '@opentelemetry/api',
      '@opentelemetry/sdk-node',
      'fastify',
      'jose',
      'js-yaml',
      'lru-cache',
      'pino',
      'undici',
      'zod',
    ],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
])
