# Tsed Helper

Collection of decorators, utilities and services for building Ts.ED backend applications with Prisma.

## Installation

```bash
npm install @januscaler/tsed-helper
```

## Filter Reference

Nine filter modes translate declarative search payloads into Prisma queries. Each mode behaves differently depending on the field's Prisma scalar type.

| Mode | Description | String | Int/Float/Decimal | DateTime | Boolean | Relation |
|------|-------------|--------|-------------------|----------|---------|----------|
| `EQ` | Equals / Matches | `contains` + insensitive | `equals` | Date-only (`YYYY-MM-DD`) auto-ranges full day; otherwise `equals` | `equals` | `some.id.in` (array) or `equals` (scalar) |
| `EX` | Excludes / Not match | `not.contains` | `not.equals` | `not.equals` | `not.equals` | `none.id.in` (array) or `not.in` |
| `LT` | Less than | — | `<` | `<` Date | — | — |
| `LTE` | Less than or equal | — | `<=` | `<=` Date | — | — |
| `GT` | Greater than | — | `>` | `>` Date | — | — |
| `GTE` | Greater than or equal | — | `>=` | `>=` Date | — | — |
| `EM` | Empty / Null | sets field to `null` | sets field to `null` | sets field to `null` | — | — |
| `NEM` | Not empty / Not null | `not: null` | `not: null` | `not: null` | — | — |
| `RG` | Range | — | `gte` + `lte` | `gte` start + `<` (end+1 day) | — | — |

### Filter Payload Format

```typescript
// Single filter group (AND within, OR across groups)
{
  "filters": [
    { "name": { "mode": "EQ", "value": "john" } }
  ]
}

// Multiple OR groups
{
  "filters": [
    { "name": { "mode": "EQ", "value": "john" }, "age": { "mode": "GT", "value": 18 } },
    { "email": { "mode": "EQ", "value": "admin@acme.io" } }
  ]
}

// Date-only search (auto-ranges 2024-01-15 → whole day)
{ "createdAt": { "mode": "EQ", "value": "2024-01-15" } }

// Relation filter
{ "roles": { "mode": "EQ", "value": [1, 2], "isRelation": true } }

// Range search
{ "price": { "mode": "RG", "value": [5, 30] } }
{ "createdAt": { "mode": "RG", "value": ["2024-10-13T16:15:57.132Z", "2024-10-20T16:15:57.132Z"] } }
```

## Dynamic CRUD Swagger Generation

Composable decorators and helpers that build Swagger docs for CRUD endpoints from your Prisma schema.

### Controller Decorators

`createItem`, `updateItem`, `deleteItem`, `getItem`, and `getItems` wrap Ts.ED HTTP decorators with consistent summaries and response models. `getItems` emits a typed `{ items, total }` payload.

```typescript
import { createItem, getItems } from "@januscaler/tsed-helper";
import { UserModel } from "@tsed/prisma";

@Controller("/users")
export class UsersController {
  @createItem({ model: UserModel })
  async create(@BodyParams() data: any) { return this.service.create(data); }

  @getItems({ model: UserModel })
  async getAll(@BodyParams(UserSearchParams) params: UserSearchParams) {
    return this.service.getAll({ ...params });
  }
}
```

### Prisma-Aware Search Params

`makeSearchParamsForPrismaModel('User')` inspects your Prisma DMMF to generate search filter examples, `orderBy` hints, and nested relation field hints for Swagger. The returned class extends `BaseSearchParams` with `fields`, `orderBy`, and `filters` properties.

```typescript
import { makeSearchParamsForPrismaModel } from "@januscaler/tsed-helper";
import { UserModel } from "@tsed/prisma";

const BaseUserSearchParams = await makeSearchParamsForPrismaModel(UserModel.name);
export class UserSearchParams extends BaseUserSearchParams {}
```

Extend the generated class to attach validation decorators or expose a named DTO:

```typescript
@getItems({ model: UserModel })
async getAll(@BodyParams(UserSearchParams) searchParams: UserSearchParams) {
  return this.service.getAll({ ...searchParams });
}
```

### SearchParams Shape

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `limit` | `number` | `10` | Page size |
| `offset` | `number` | `0` | Pagination offset |
| `fields` | `string[]` | — | Prisma `select` fields. Supports dot notation for relations (`roles.name`) |
| `orderBy` | `Record<string, 'asc' \| 'desc'>` | `{ id: 'asc' }` | Sort specification |
| `filters` | `SearchFilterRecord[]` | — | Array of filter groups, each OR'd together |
| `countTotal` | `boolean` | `true` | When false, skips the count query for faster response |

## BaseService

The `BaseService<T, M>` class in [`src/baseService.ts`](src/baseService.ts) wraps a Prisma repository with lifecycle events, relation mapping, computed fields, and search infrastructure.

### Constructor & Configuration

```typescript
import { BaseService } from "@januscaler/tsed-helper";
import { PrismaService } from "@tsed/prisma";

@Injectable()
export class UsersService extends BaseService<Prisma.UsersDelegate, UsersModel> {
  constructor(prisma: PrismaService) {
    super("UsersModel", prisma);
  }
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `tsedPrismaModelName` | `string` | Ts.ED Prisma model name (e.g. `"UsersModel"`) |
| `prismaService` | `PrismaService` | Injected Prisma service instance |
| `relativePrismaFilePath` | `string?` | Override schema path (default `"./prisma/schema.prisma"`) |

### Lifecycle Hooks

RxJS `Subject` instances broadcast CRUD events for side effects like caching, auditing, or logging:

```typescript
service.onPostUpdate.subscribe(({ id, result }) => logger.info({ id, result }));
service.onPreCreate.subscribe(({ data }) => validateData(data));
```

| Hook | Emits |
|------|-------|
| `onPreCreate` | `{ data }` |
| `onPostCreate` | `{ data, result }` |
| `onPreUpdate` | `{ id, inputData }` |
| `onPostUpdate` | `{ id, inputData, result }` |
| `onPreDelete` | `{ id }` |
| `onPostDelete` | `{ id, result }` |

### CRUD Methods

#### `create(data, options?, tx?)`

Creates a record with optional relation operations. Lifecycle hooks fire before and after.

```typescript
await service.create({ title: "Draft", tags: [1, 2] }, {
  relationOperation: "connect",
  relationvalueMapper: (field, ids) => ids.map((id) => ({ id })),
});
```

#### `update(id, data, options?, tx?)`

Updates a record, splitting scalar fields from relation fields automatically.

```typescript
await service.update(42, { title: "Published", tags: [3, 4] }, {
  relationOperation: "set",
  relationvalueMapper: (field, ids) => ids.map((id) => ({ id })),
});
```

#### `deleteItem(id, tx?)`

Deletes by id. Fires `onPreDelete` and `onPostDelete`.

#### `getOne(id)`

Returns the record or `null` if not found.

#### `getManyByIds(ids, select?)`

Batch fetch multiple records by their ids. Optional `select` for field selection.

```typescript
const users = await service.getManyByIds([1, 2, 3], { id: true, name: true });
```

#### `getAll(params)`

Full search with filters, ordering, field selection, and computed field support. Two execution paths:

- **Fast path**: When no computed fields are active, uses a single Prisma query with aggregate count.
- **In-memory path**: When computed fields are involved, fetches up to 10,000 records, applies computed filters/sorts in JS, then paginates.

```typescript
const { items, total } = await service.getAll({
  fields: ["name", "email", "roles.name"],
  filters: [{ name: { mode: "EQ", value: "john" } }],
  orderBy: { name: "asc" },
  offset: 0,
  limit: 20,
  countTotal: true,
});
```

#### `count(where?)`

Count records matching optional Prisma `where` clause.

#### `exists(id)`

Check if a record with the given id exists. Returns `boolean`.

#### `upsert(where, create, update)`

Prisma upsert — creates if not found, updates if exists.

### Relation Operations

The `buildPayloadWithRelations` helper in [`src/relationPayload.ts`](src/relationPayload.ts) automatically splits incoming data into scalar fields and relation fields, applying Prisma relation operations to each relation key.

**Create relation operations**: `connect` (default), `connectOrCreate`, `create`, `createMany`

**Update relation operations**: `set` (default), `disconnect`, `delete`, `connect`, `disconnectMany`, `deleteMany`, `create`, `createMany`, `update`, `updateMany`, `upsert`, `upsertMany`

```typescript
type CreateRelationMapper = {
  relationOperation?: 'connect' | 'connectOrCreate' | 'create' | 'createMany';
  relationvalueMapper?: (fieldName: string, value: any) => any;
};

type UpdateRelationMapper = {
  relationOperation?: 'set' | 'disconnect' | 'delete' | 'connect'
    | 'disconnectMany' | 'deleteMany' | 'create' | 'createMany'
    | 'update' | 'updateMany' | 'upsert' | 'upsertMany';
  relationvalueMapper?: (fieldName: string, value: any) => any;
};
```

The default `relationvalueMapper` wraps array values as `[{ id }, ...]` and scalar values as `{ id }`.

### Transactional Support

`create`, `update`, and `deleteItem` accept an optional `tx` parameter (Prisma interactive transaction client). When provided, the operation runs within that transaction instead of the default repository:

```typescript
await prisma.$transaction(async (tx) => {
  const user = await service.create({ name: "Alice" }, {}, tx);
  await service.update(user.id, { verified: true }, {}, tx);
});
```

### Computed Fields

Define virtual fields computed from Prisma data. The search infrastructure splits filters and orderBy between Prisma-native and computed fields, applying in-memory filtering/sorting/pagination when computed fields are involved.

```typescript
service.computedFields = [
  {
    name: "fullName",
    needs: ["firstName", "lastName"],
    compute: (user) => `${user.firstName} ${user.lastName}`,
    type: "string",
    filterable: true,
    sortable: true,
  },
  {
    name: "age",
    needs: ["birthDate"],
    compute: (user) => calculateAge(user.birthDate),
    type: "number",
    filterable: true,
    sortable: true,
  },
  {
    name: "roleDisplay",
    needs: ["role"],
    compute: (user) => user.role?.name ?? "None",
    type: "string",
    prismaComputed: true, // Prisma $extends already computes this
  },
];
```

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Field name exposed in the API |
| `needs` | `string[]` | Prisma fields required for computation (auto-injected into `select`) |
| `compute` | `(item) => any` | Synchronous or async computation function |
| `type` | `'boolean' \| 'number' \| 'string'` | Value type for filter coercion |
| `filterable` | `boolean?` | Allow filtering by this field (default `false`) |
| `sortable` | `boolean?` | Allow sorting by this field (default `false`) |
| `prismaComputed` | `boolean?` | When `true`, field is NOT stripped from Prisma select and NOT re-attached after query (Prisma $extends already provides it) |

### Prisma Client Extensions

Use `extend()` to register Prisma `$extends` computed fields that Prisma evaluates at query time:

```typescript
service.extend({
  roleDisplay: {
    needs: { role: true },
    compute: (user) => user.role?.name ?? "None",
  },
});
```

### Filter Mappers

The `filterMappers` object in [`src/filterMappers.ts`](src/filterMappers.ts) maps filter modes to Prisma query builders and is available for direct import:

```typescript
import { filterMappers, isNumericType } from "@januscaler/tsed-helper";
```

## Prisma Schema Metadata Utilities

[`src/prismaMetaMapper.ts`](src/prismaMetaMapper.ts) parses your Prisma schema once and caches the Data Model Meta Format (DMMF) for fast subsequent access.

- `PrismaMetaMapper.getTablesInfo()` returns a model map with field metadata, unique constraints, and primary keys. Results are cached after the first call.
- `PrismaMetaMapper.getEntityFieldMapping('User')` produces a keyed object describing field types, relations, and default values.
- `PrismaMetaMapper.invalidateCache()` clears the DMMF cache — useful after schema changes at runtime.
- `PrismaMetaMapper.normalizeEntityName('UsersModel')` strips the `Model` suffix and pascalCases (returns `"Users"`).
- Set `PrismaMetaMapper.relativePrismaFilePath` before bootstrapping if your schema file lives elsewhere.

```typescript
PrismaMetaMapper.relativePrismaFilePath = "./apps/api/prisma/schema.prisma";
const usersInfo = await PrismaMetaMapper.getEntity("User");
const emailField = usersInfo.fields.find((field) => field.name === "email");
```

## Seeder Helper Toolkit

Seed orchestration utilities live in [src/seederHelper.ts](src/seederHelper.ts) and help discover, order, and execute seed scripts alongside Prisma relations.

- `getAllSeeds()` globs controllers (default `./src/controllers/rest/**/seed.ts`) and loads their exports under a keyed entity map.
- `generatePrismaCreateUpdatePayload()` transforms plain seed rows into Prisma `create` payloads, automatically resolving relation IDs or eager-connect requests (`*`).
- `sortEntitiesByDependency()` performs a topological sort so dependent seeds run after their prerequisites.

```typescript
const helper = new SeederHelper();
const seeds = await helper.getAllSeeds();
const order = helper.sortEntitiesByDependency(seeds, ["roles", "users"]);

for (const entity of order) {
  const payload = await helper.generatePrismaCreateUpdatePayload({
    rowData: seeds[entity].rows,
    entity,
    prismaService,
  });
  await prismaService[entity].createMany({ data: payload });
}
```

## Shared Types

Common search filter types are defined in [src/types.ts](src/types.ts) and exported through the package entry point.

- `SearchFilterValue` describes the dynamic filter payload `{ mode, value, isRelation }` used in request bodies.
- `SearchFilterRecord` maps entity field names to `SearchFilterValue` descriptors and is leveraged by `BaseService#getAll` when building Prisma filters.

```typescript
const filters: SearchFilterRecord = {
  email: { mode: "EQ", value: "admin@acme.io" },
  roles: { mode: "EQ", value: [1, 2], isRelation: true },
};
```

## Package Exports

The barrel file [`src/index.ts`](src/index.ts) re-exports all modules:

| Module | Export path | Description |
|--------|-------------|-------------|
| `baseCrud` | `@januscaler/tsed-helper` | Controller decorators, SearchParams, `makeSearchParamsForPrismaModel` |
| `baseService` | `@januscaler/tsed-helper` | `BaseService` class with CRUD, lifecycle, computed fields, search |
| `prismaMetaMapper` | `@januscaler/tsed-helper` | DMMF parser, entity metadata, caching |
| `seederHelper` | `@januscaler/tsed-helper` | Seed discovery, ordering, Prisma payload generation |
| `types` | `@januscaler/tsed-helper` | `FilterMode`, `SearchFilterValue`, `SearchFilterRecord` |
| `filterMappers` | `@januscaler/tsed-helper` | Filter mode → Prisma query mappers, `isNumericType` helper |
| `relationPayload` | `@januscaler/tsed-helper` | `buildPayloadWithRelations` for scalar/relation field splitting |
| `searchHelpers` | `@januscaler/tsed-helper` | Search param splitting, computed field pipeline, in-memory sort/filter/paginate |
