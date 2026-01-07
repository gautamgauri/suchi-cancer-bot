# Linting and Code Quality

## Setup

Linting is configured using ESLint with TypeScript support.

### Install Dependencies

```bash
cd eval
npm install
```

### Run Checks

```bash
# Type checking only
npm run typecheck

# Linting only
npm run lint

# Both (recommended)
npm run check

# Auto-fix linting issues (where possible)
npm run lint:fix
```

## Current Status

✅ **TypeScript Compilation**: PASSING  
✅ **ESLint Errors**: 0 errors  
⚠️ **ESLint Warnings**: 20 warnings (all `any` type warnings - acceptable)

### Warnings Breakdown

All remaining warnings are about `any` types, which are acceptable for:
- Error handling (`catch (error: any)`)
- Dynamic configuration objects
- Third-party library types

These can be addressed incrementally but don't block functionality.

## Linting Rules

### Enabled Rules

- `@typescript-eslint/recommended` - TypeScript best practices
- `eslint:recommended` - JavaScript best practices
- `no-case-declarations` - Prevents variable declarations in case blocks
- `prefer-const` - Prefers const over let
- `no-var` - Disallows var declarations

### Warning-Level Rules

- `@typescript-eslint/no-explicit-any` - Warns about `any` types (not errors)
- `@typescript-eslint/no-unused-vars` - Warns about unused variables

## Pre-commit Checklist

Before committing, run:

```bash
npm run check
```

This ensures:
- ✅ TypeScript compiles without errors
- ✅ No ESLint errors
- ⚠️ Warnings are acceptable

## CI/CD Integration

Add to your CI pipeline:

```yaml
- name: Check code quality
  run: |
    cd eval
    npm install
    npm run check
```

## Auto-fix

Many linting issues can be auto-fixed:

```bash
npm run lint:fix
```

This will fix:
- Formatting issues
- Prefer const
- Unused imports (in some cases)

## Ignored Files

The following are excluded from linting:
- `dist/` - Build output
- `node_modules/` - Dependencies
- `*.js` - JavaScript files (we only lint TypeScript)
- `*.json` - JSON config files
- `scripts/*.ps1` - PowerShell scripts
- `scripts/*.sh` - Shell scripts





