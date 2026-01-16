# Tsed Helper

This package is a collection of decorators,utilities and services that can be used to simplify the development of Tsed backend applications.(microservice)

## Installation

```bash
npm install @januscaler/tsed-helper
```

## Usage

### Range Search

```typescript
//   for numbers
{
  "field":{
      mode:"RG",
      value:[5,30]
  }
}
//   for date
{
  "field":{
      "mode":"RG",
     "value":["2024-10-13T16:15:57.132Z","2024-10-13T16:15:57.132Z"]
  }
}
```

## Dynamic CRUD Swagger Generation (v2.3.4)

The latest release adds composable decorators and helper utilities that build complete Swagger documentation for CRUD endpoints from your Prisma schema.

### Controller Decorators

- `createItem`, `updateItem`, `deleteItem`, `getItem`, and `getItems` wrap the Ts.ED HTTP decorators with consistent summaries and response models.
- `getItems` now emits a typed `{ items, total }` payload so the search output is documented automatically.

### Prisma-Aware Search Params

- `makeSearchParamsForPrismaModel('User')` inspects your Prisma DMMF to emit search filters, orderBy examples, and nested relation hints for Swagger.
- Use the generated class as the DTO for search endpoints to surface filter capabilities directly in Swagger UI.

```typescript
import { UserModel } from "@tsed/prisma";
import { makeSearchParamsForPrismaModel } from "@januscaler/tsed-helper";

const BaseUserSearchParams = await makeSearchParamsForPrismaModel(UserModel.name);
export class UserSearchParams extends BaseUserSearchParams {}
```

- The returned class can be extended to attach validation decorators (e.g. `@CollectionOf`, `@Enum`, `@Min`) or to expose a named DTO when wiring controllers.

```typescript
@getItems({ model: UserModel })
async getAll(@BodyParams(UserSearchParams) searchParams: UserSearchParams) {
  return this.service.getAll({ ...searchParams });
}
```

### Base Service Enhancements

- `BaseService#getAll` now consumes the generated search params to translate filter modes (`EQ`, `RG`, `EM`, etc.) into Prisma queries.
- Subscribable lifecycle hooks (`onPreCreate`, `onPostUpdate`, ...) remain available so you can react to CRUD events while keeping Swagger documentation up to date.

## Base Service Lifecycle & Relation Mapping

The service utilities in [src/baseService.ts](src/baseService.ts) wrap a Prisma repository with Ts.ED-friendly lifecycle events and relation mapping helpers.

- Constructor options accept the Prisma model name and service instance; optionally override `relativePrismaFilePath` if your schema lives outside `./prisma/schema.prisma`.
- Lifecycle subjects (`onPreCreate`, `onPostDelete`, etc.) broadcast CRUD events that can be subscribed to for side effects like caching or auditing.
- Relation helpers accept a `relationOperation` and optional `relationvalueMapper` to translate plain arrays into Prisma relation payloads automatically.

```typescript
const service = new BaseService("UsersModel", prismaService);

service.onPostUpdate.subscribe(({ id, result }) => logger.info({ id, result }));

await service.update(
  42,
  { title: "Draft", tags: [1, 2] },
  {
    relationOperation: "set",
    relationvalueMapper: (field, ids) => ids.map((id) => ({ id })),
  }
);
```

Extend the class to expose domain-specific helpers while keeping the shared search utilities:

```typescript
@Injectable()
export class UsersService extends BaseService<Prisma.UsersDelegate, UsersModel> {
  constructor(prisma: PrismaService) {
    super("UsersModel", prisma);
  }
}
```

## Prisma Schema Metadata Utilities

[src/prismaMetaMapper.ts](src/prismaMetaMapper.ts) exposes static helpers that parse your Prisma schema once and cache the Data Model Meta Format (DMMF).

- `PrismaMetaMapper.getTablesInfo()` returns a model map with field metadata, unique constraints, and primary keys.
- `PrismaMetaMapper.getEntityFieldMapping('User')` produces a keyed object describing field types, relations, and default values, enabling runtime documentation and validation.
- Set `PrismaMetaMapper.relativePrismaFilePath` before bootstrapping if your schema file resides elsewhere.

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

The root barrel file [src/index.ts](src/index.ts) re-exports every decorator, service, helper, and type so consumers can import from `@januscaler/tsed-helper` without deep paths.
