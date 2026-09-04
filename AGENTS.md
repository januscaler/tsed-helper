# tsed-helper — @januscaler/tsed-helper (Ts.ED + Prisma utilities)

## Project
Decorators, utilities, and services for Ts.ED backend applications with Prisma. Published as the npm package `@januscaler/tsed-helper`.

## Commands
- Build: `npm run build` (tsc → dist)
- Test: `npm test` (build + `node --test test/**/*.test.mjs`)
- Format: `npm run prettier`

## Architecture
- `src/index.ts` — public API
- `src/baseCrud.ts`, `src/baseService.ts` — reusable CRUD/service base
- `src/filterMappers.ts` — nine filter modes (EQ, EX, LT, LTE, GT, GTE, EM, NEM, RG) mapping declarative payloads to Prisma queries
- `src/prismaMetaMapper.ts`, `src/relationPayload.ts`, `src/searchHelpers.ts`, `src/seederHelper.ts`, `src/types.ts`
- `test/` — node:test suites

## Conventions
- Filter-mode semantics per Prisma scalar type are documented in README (string/date/boolean/relation differences) — keep them in sync when changing `filterMappers.ts`
- Package is published; bump version + rebuild dist before release

## Notes
