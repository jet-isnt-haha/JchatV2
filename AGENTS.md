# JChatV2 - AI Agent Instructions

This repository is a monorepo managed with `pnpm` workspaces. It contains a React/Vite client, a NestJS server, and a shared types package.

## 📁 Project Structure

- `/client` - React 19 application using Vite, Tailwind CSS 4, shadcn/ui, and Vitest.
- `/server` - NestJS 11 backend using LangChain for AI features.
- `/shared` - Shared TypeScript types/interfaces exported as `@jchat/shared` and used by both client and server.

## 🛠️ Commands

Execute commands from the root directory unless otherwise specified. Use `pnpm` for all dependency management and script execution.

### Build & Run
- **Start Client (Dev):** `pnpm dev:client`
- **Start Server (Dev):** `pnpm dev:server`
- **Build Client:** `pnpm build:client`
- **Build Server:** `pnpm build:server`
- **Install Dependencies:** `pnpm install`

### Testing
The client uses Vitest for testing. The server typically uses Jest (NestJS default).

- **Run All Client Tests:** `pnpm --filter client test`
- **Run a Single Client Test:** `pnpm --filter client exec vitest run path/to/file.test.ts`
- **Run Client Tests in Watch Mode:** `pnpm --filter client exec vitest`

*(Note: Server testing commands will depend on standard NestJS testing module if installed. Typical command: `pnpm --filter server run test`)*

### Linting & Formatting
- **Lint Client:** `pnpm --filter client lint`
- **Fix Client Lint Issues:** `pnpm --filter client lint --fix`

## 📝 Code Style Guidelines

### General
- **Language:** TypeScript (`.ts`, `.tsx`). Avoid using `.js` or `.jsx`.
- **Absolute Paths:** Always use absolute workspace boundaries for shared imports (e.g., `import { Type } from '@jchat/shared'`).
- **Formatting:** Use Prettier standard formatting (if configured) or match the surrounding code's indentation (typically 2 spaces).

### Client (React/Vite)
- **Component Style:** Use functional components with React Hooks. Avoid Class components.
- **Styling:** Use Tailwind CSS 4 utility classes via the `className` attribute. Use the `cn()` utility (usually provided by tailwind-merge/clsx in shadcn projects) for dynamic class merging.
- **UI Components:** Use shadcn/ui for baseline UI components. Locate them before building custom primitives.
- **Icons:** Use `lucide-react` for icons.
- **State Management:** Keep state as localized as possible. If global state is necessary, use React Context or lightweight tools before reaching for heavy libraries.

### Server (NestJS)
- **Architecture:** Strictly adhere to the NestJS modular architecture (Controllers, Services, Modules).
- **Dependency Injection:** Use dependency injection for services and providers. Do not instantiate classes manually if they are meant to be providers.
- **Asynchronous Code:** Prefer `async/await` over raw Promises or RxJS Observables unless integrating strictly with NestJS reactive guards/interceptors.
- **Configuration:** Use `@nestjs/config` for environment variables and secrets. Never hardcode secrets.

### Shared
- **Types:** Place domain models, interfaces, DTOs, and shared enumerations in the `/shared` workspace. 
- Ensure that you run build/typecheck in the shared workspace if needed before relying on those types in the client or server.

## 🤖 Agent Workflow Mandates
1. **Self-Correction:** Before claiming a feature is complete, always run the linter and TypeScript compiler.
2. **Atomic Commits:** Make discrete changes. If refactoring, don't mix it with feature additions.
3. **No Assumptions:** Never assume standard npm scripts exist without reading the respective `package.json` first.
4. **Tool Constraints:** Use absolute paths when executing filesystem operations (`read`, `write`, `edit`). Always use forward slashes or double backslashes in paths on this Windows environment.