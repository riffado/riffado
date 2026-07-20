# v0.6.0 production dependency audit

Checked 2026-07-17 with `pnpm audit --prod` after upgrading direct runtime dependencies and pinning compatible patched transitive releases.

## Remediated

- Next.js: upgraded to 16.2.10.
- Better Auth: upgraded to 1.6.23.
- Drizzle ORM: upgraded to 0.45.2.
- Undici: upgraded to 7.28.0.
- Nodemailer: upgraded to 9.0.3.
- Development-only React Email CLI and Vitest were moved out of runtime dependencies.
- Compatible patched releases of `@protobufjs/utf8`, `defu`, `js-yaml`, `postcss`, `rollup`, and `vite` are enforced through `pnpm-workspace.yaml`.

## Remaining development-server advisories

The remaining esbuild advisories are introduced by CLI/development tooling nested under Better Auth and Fumadocs. The vulnerable behavior requires running an esbuild development server, which Riffado does not use in production. The production Next.js server does not import or expose esbuild. These findings are not runtime-reachable.

## Remaining protobufjs advisories

`pnpm audit --prod` still reports one critical and five high advisories through:

```text
@xenova/transformers -> onnxruntime-web -> onnx-proto -> protobufjs@6
```

The installed `onnx-proto@4.0.4` requires `protobufjs@^6.8.8`; the patched protobufjs releases are a different major line, so forcing an override would be an unverified compatibility change to the privacy-critical browser transcription path.

### Reachability assessment

Riffado imports `@xenova/transformers` only from `src/lib/transcription/worker.ts`, a browser Web Worker. The server does not import or execute this dependency. Model identifiers originate from the fixed allowlist in `src/lib/transcription/browser-transcriber.ts` and point to the three maintained `Xenova/whisper-*` repositories.

`onnx-proto` ships a generated, application-defined ONNX schema in `dist/onnx.js`. Riffado does not call protobufjs reflection APIs such as `parse`, `Root.load`, `Root.loadSync`, or `Root.fromJSON`, and it does not accept protobuf schemas or JSON descriptors from users. The schema-controlled code-execution and unsafe-option advisories therefore do not have an attacker-controlled descriptor path in Riffado.

The message-expansion and recursion advisories operate while decoding protobuf data. In Riffado that work runs inside the requesting user's short-lived browser worker against a model fetched for a fixed model identifier. It does not execute in a shared Next.js process, does not cross tenant boundaries, and cannot expose server credentials or hosted data. A malformed upstream model could terminate or stall that user's transcription worker, which is an availability failure isolated to the browser session.

### Release decision

These findings are not reachable as server-side or cross-tenant vulnerabilities in the current architecture. They do not block v0.6.0. Do not add user-controlled model or schema URLs without revisiting this assessment. Do not force-upgrade protobufjs independently of `onnx-proto`/Transformers.js; upgrade the browser transcription stack as a tested unit when its maintained package line provides patched dependencies.
