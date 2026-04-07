# Contributing to packforge

Thanks for your interest in contributing! This document explains how to get started.

## Prerequisites

- Node.js >= 20
- npm >= 10

## Setup

```bash
git clone https://github.com/mutigen/packforge.git
cd packforge
npm install
npx turbo build
```

## Development Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Run the full CI check locally:

```bash
npm run ci
```

4. Commit with a clear message
5. Open a Pull Request

## Adding a New Pack

1. Create a YAML file in the appropriate `packs/{category}/` directory
2. Follow the schema defined in `packages/shared-types/src/pack.ts`
3. Run `npm run validate:packs` to verify
4. Update activation signals so the orchestrator can match it

## Code Style

- TypeScript strict mode with `exactOptionalPropertyTypes`
- Prettier for formatting (runs on pre-commit via lint-staged)
- No `any` types unless absolutely necessary

## Testing

```bash
npm test                # Run all tests
npx turbo test --filter=orchestrator  # Run tests for a specific package
```

## Commit Messages

Use clear, imperative-mood messages:

- `add pack for api-documentation`
- `fix matcher scoring for gitnexus packs`
- `update context analyzer to read cluster labels`

## License

By contributing, you agree that your contributions will be licensed under the
[PolyForm Noncommercial 1.0.0](LICENSE) license.
