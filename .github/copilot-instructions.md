# CVAT Copilot Instructions

## Architecture Overview

CVAT (Computer Vision Annotation Tool) is a full-stack annotation platform with:

- **Backend**: Django REST API (`cvat/apps/`) with PostgreSQL, Redis (in-memory + on-disk), and ClickHouse for analytics
- **Frontend**: React + Redux + Ant Design SPA (`cvat-ui/`)
- **Shared Libraries**: TypeScript packages as npm workspaces (`cvat-core/`, `cvat-canvas/`, `cvat-canvas3d/`, `cvat-data/`)
- **Python SDK/CLI**: `cvat-sdk/` and `cvat-cli/` for programmatic access

### Key Backend Apps (`cvat/apps/`)
- `engine/` - Core models (Task, Job, Project, annotations), views, serializers
- `iam/` - Authentication, permissions, OPA rules (`iam/rules/`)
- `dataset_manager/` - Import/export formats handling
- `lambda_manager/` - Serverless function integration (Nuclio)
- `quality_control/` - Annotation quality reports
- `consensus/` - Multi-annotator consensus

### Frontend Structure (`cvat-ui/src/`)
- `actions/` - Redux action creators (thunk-based async actions)
- `reducers/` - Redux state slices (see `root-reducer.ts` for full state shape)
- `components/` - React components organized by feature
- `cvat-core-wrapper.ts` - API client facade, configures `cvat-core` library

## Development Workflows

### Running Locally
```bash
# Start all services (DB, Redis, workers, etc.)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# UI dev server (connects to localhost:7000 backend)
yarn workspace cvat-ui run start
```

### Building
```bash
# Build all frontend packages
yarn build:cvat-data && yarn build:cvat-core && yarn build:cvat-canvas && yarn build:cvat-canvas3d && yarn build:cvat-ui

# Individual package
yarn workspace cvat-ui run build
```

### Testing
```bash
# Python REST API tests (auto-starts Docker containers)
pytest ./tests/python

# Cypress E2E tests (requires running CVAT instance)
cd tests && yarn cypress:run:chrome

# With debug enabled
CVAT_DEBUG_ENABLED=yes pytest --start-services tests/python
```

### Linting & Formatting
- **TypeScript/JavaScript**: ESLint with Airbnb config, auto-runs via Husky pre-commit
- **Python**: Black + isort (`dev/format_python_code.sh`), configured in `pyproject.toml`
- **SCSS**: Stylelint

```bash
# Lint specific package
yarn workspace cvat-ui run lint:fix

# Format Python
./dev/format_python_code.sh
```

## Code Patterns

### Redux Actions Pattern
Actions use thunk pattern with typed dispatch. Follow existing patterns in `cvat-ui/src/actions/`:
```typescript
export function someActionAsync(): ThunkAction {
    return async (dispatch: ThunkDispatch): Promise<void> => {
        dispatch({ type: ActionTypes.SOME_ACTION });
        try {
            const result = await cvat.someApi.method();
            dispatch({ type: ActionTypes.SOME_ACTION_SUCCESS, payload: { result } });
        } catch (error) {
            dispatch({ type: ActionTypes.SOME_ACTION_FAILED, payload: { error } });
        }
    };
}
```

### API Calls via cvat-core
All backend API calls go through `cvat-core`. Access via wrapper:
```typescript
import { getCore } from 'cvat-core-wrapper';
const cvat = getCore();
const tasks = await cvat.tasks.get({ /* filter */ });
```

### Plugin System
- Backend: `cvat-core/src/plugins.ts` - API wrapper decorators
- Frontend: `cvat-ui/src/components/plugins-entrypoint.tsx` - Register UI components via `window.cvatUI.registerComponent()`
- Plugins can be added at `cvat-ui/plugins/`

### Django REST Views
Views in `cvat/apps/engine/views.py` use DRF ViewSets with:
- Custom permissions in `permissions.py`
- OPA rules in `iam/rules/` (Rego policies)
- Serializers in `serializers.py`

## Project Conventions

### Changelog
Use scriv fragments in `changelog.d/` for changes:
```bash
scriv create  # Creates fragment file
# Edit the fragment with format: ### Added|Changed|Fixed|etc
```

### File Naming
- React components: PascalCase directories with kebab-case files (e.g., `task-page/task-page.tsx`)
- Python: snake_case modules
- TypeScript types: Define in `*-types.ts` or inline

### Import Order (ESLint enforced)
1. Built-in modules
2. External packages
3. Internal modules (use absolute paths from `src/`)

### Backend Workers
Background jobs run via Django-RQ workers defined in `docker-compose.yml`:
- `cvat_worker_import` / `cvat_worker_export` - Dataset operations
- `cvat_worker_annotation` - Annotation processing
- `cvat_worker_quality_reports` - Quality calculations
