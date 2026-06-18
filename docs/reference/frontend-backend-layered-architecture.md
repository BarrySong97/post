# Frontend And Backend Layered File Architecture

This guide is a reusable project template for frontend/backend applications that need clear boundaries, shared contracts, and backend-style layering.

It works for HTTP apps, Electron apps, local-first desktop apps, and monorepos. Rename folders to match the framework, but keep the dependency direction.

## Goals

- Keep transport code thin.
- Keep user workflows in explicit use cases.
- Keep business rules testable and side-effect free.
- Keep database, filesystem, network, and native APIs behind infrastructure adapters.
- Keep frontend/backend shared schemas in one browser-safe contract layer.
- Keep files small enough to review; use 500 lines as a hard smell threshold.

## Top-Level Shape

```text
src/
  frontend/
  shared/
  backend/
```

For monorepos, this can become:

```text
apps/
  web/
  desktop/
packages/
  contracts/
  ui/
  db/
```

Use whichever shape fits the project. The important split is:

```text
frontend -> shared/contracts
backend  -> shared/contracts
frontend never imports backend runtime code
```

## Recommended File Tree

```text
src/
  shared/
    contracts/
      common/
        id.contract.ts
        pagination.contract.ts
      users/
        user.contract.ts
      assets/
        asset-list.contract.ts
        asset-actions.contract.ts
      projects/
        project.contract.ts

  frontend/
    app/
      routes/
      providers/
    pages/
    components/
    hooks/
    lib/
      api-client.ts
      query-client.ts
    state/

  backend/
    index.ts

    bootstrap/
      app-lifecycle.ts
      server.ts
      window.ts

    presentation/
      http/
        server.ts
        routes/
          assets.route.ts
          users.route.ts
      rpc/
        router.ts
        adapters/
      ipc/
        window-controls.ipc.ts
      protocols/
        file.protocol.ts

    use-cases/
      assets/
        list-assets.ts
        get-asset-by-id.ts
        create-asset.ts
        delete-asset.ts
      users/
        create-user.ts
        update-user.ts
      projects/
        create-project.ts
        archive-project.ts

    domain/
      assets/
        asset-rules.ts
        asset-filters.ts
      users/
        user-rules.ts
      projects/
        project-rules.ts

    infrastructure/
      db/
        connection.ts
        repositories/
          assets-repository.ts
          users-repository.ts
      filesystem/
        file-storage.ts
      external-services/
        email-client.ts
        search-client.ts
      events/
        event-bus.ts
      native/
        shell-service.ts
```

## Layer Responsibilities

### Shared Contracts

`shared/contracts` owns schemas and types shared by frontend and backend:

- Zod input schemas
- DTO-like transport types
- pagination contracts
- filter/sort enum values
- form validation constants

Rules:

- Do not import backend runtime code.
- Do not import database connections.
- Do not import filesystem, native, or server APIs.
- Keep it browser-safe.

Example:

```ts
export const createAssetInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  tagIds: z.array(z.string().min(1)).default([]),
});

export type CreateAssetInput = z.infer<typeof createAssetInputSchema>;
```

### Frontend

`frontend` owns UI and client-side state:

- routes
- pages
- components
- forms
- client hooks
- local UI state
- API/RPC client setup

Rules:

- May import `shared/contracts`.
- May import generated or inferred API types.
- Must not import backend runtime modules.
- Must not touch database, filesystem, native APIs, or server process state directly.

### Presentation

`backend/presentation` owns request/transport adapters:

- HTTP controllers/routes
- tRPC routers
- GraphQL resolvers
- Electron IPC handlers
- native protocol handlers

It should be thin:

```ts
export const assetsRoute = route({
  input: createAssetInputSchema,
  handler: ({ input }) => createAsset(input),
});
```

Rules:

- Validate input with shared contracts.
- Translate transport-specific errors if needed.
- Call use cases.
- Avoid business workflow code here.
- Avoid direct database writes here.

### Use Cases

`backend/use-cases` owns complete user or system workflows.

A use case answers: "The user wants to do one thing. What steps does the system perform?"

Examples:

- `create-asset.ts`
- `delete-tag.ts`
- `import-project.ts`
- `send-invitation.ts`
- `open-file-in-editor.ts`

Typical responsibilities:

- Load required records.
- Enforce existence and ownership checks.
- Call domain rules.
- Call repositories.
- Call infrastructure adapters.
- Publish events.
- Return transport-safe results.

Example:

```ts
export async function createAsset(input: CreateAssetInput) {
  const title = normalizeTitle(input.title);
  await assertTagsExist(input.tagIds);
  const asset = await assetsRepository.insert({ title, tagIds: input.tagIds });
  await eventBus.publish({ type: "asset.created", assetId: asset.id });
  return asset;
}
```

### Domain

`backend/domain` owns pure business rules.

Domain functions should be easy to unit test because they do not perform side effects.

Good domain code:

- normalize names
- deduplicate IDs
- parse filter JSON
- validate state transitions
- calculate derived status
- choose default values

Bad domain code:

- database queries
- filesystem reads
- HTTP calls
- Electron/native APIs
- process spawning

Example:

```ts
export function normalizeTitle(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
```

### Infrastructure

`backend/infrastructure` owns side effects:

- database connections
- repositories
- filesystem storage
- external service clients
- native shell APIs
- background workers
- event bus implementation

Rules:

- Repositories read/write data. They should not orchestrate full user workflows.
- Adapters hide third-party APIs from use cases.
- Infrastructure can depend on domain types, but domain must not depend on infrastructure.

## Dependency Direction

Keep this direction:

```text
frontend -> shared/contracts

presentation -> shared/contracts
presentation -> use-cases

use-cases -> domain
use-cases -> infrastructure
use-cases -> shared/contracts types

infrastructure -> domain
infrastructure -> database/external/native libraries

domain -> no side-effect layers
```

Avoid this:

```text
frontend -> backend
domain -> infrastructure
repository -> use-case
contract -> backend runtime
```

## File Size Targets

Use these as review heuristics:

```text
route/controller/router file:      < 200 lines
contract file:                     < 200 lines
single use case file:              < 150 lines
repository file:                   < 350 lines
manager/coordinator file:          < 400 lines
hard smell threshold:              500 lines
```

When a file exceeds 500 lines, first ask whether it contains multiple responsibilities. Prefer splitting by responsibility over adding more local helpers.

## Naming

Use consistent suffixes:

```text
*.contract.ts       shared input/output schemas
*.route.ts          HTTP routes/controllers
*.router.ts         tRPC/RPC router
*.ipc.ts            IPC handlers
*.protocol.ts       native/custom protocol handlers
*.repository.ts     database persistence boundary
*.rules.ts          pure domain rules
```

Use verb-based names for use cases:

```text
create-user.ts
update-project.ts
delete-tag.ts
list-assets.ts
open-file.ts
```

## Request Flow Examples

### HTTP Or RPC App

```text
frontend form
  -> shared contract validation
  -> API/RPC client
  -> backend/presentation route/router
  -> backend/use-cases/create-asset.ts
  -> backend/domain/asset-rules.ts
  -> backend/infrastructure/db/repositories/assets-repository.ts
  -> database
```

### Electron App

```text
renderer component
  -> shared contract validation
  -> preload bridge
  -> Electron IPC
  -> backend/presentation/ipc or tRPC adapter
  -> backend/use-cases/open-file.ts
  -> backend/infrastructure/native/shell-service.ts
```

## Placement Checklist

Ask these questions when adding code:

```text
Is this schema used by frontend and backend?
  -> shared/contracts

Is this UI, form state, or client data fetching?
  -> frontend

Is this accepting a request and calling one function?
  -> presentation

Is this a full user/system action with multiple steps?
  -> use-cases

Is this a pure rule or transformation?
  -> domain

Is this database, filesystem, network, process, or native API work?
  -> infrastructure
```

## Migration Order For Existing Projects

1. Add `shared/contracts` and move duplicated frontend/backend schemas there.
2. Make presentation handlers thin by moving workflows into `use-cases`.
3. Move pure helpers from handlers/repositories into `domain`.
4. Split repositories by query/write responsibility.
5. Move native, filesystem, network, and process code into `infrastructure` adapters.
6. Tighten path aliases so frontend cannot import backend runtime code.
7. Add file-size checks or review rules around the 500-line threshold.

## Practical Rule

Use cases are workflows. Domain is rules. Infrastructure is side effects. Presentation is the request adapter. Shared contracts are the boundary between frontend and backend.
