# web/

Vite + React 19 + TypeScript UI for ShadeCast.

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm test         # vitest, 48 tests this tree
npm run build
```

Locally, leave `VITE_API_BASE` empty. Vite proxies `/api` and `/healthz` to `http://127.0.0.1:8000` (`vite.config.ts`). The static Render build needs `VITE_API_BASE` set to the API origin at build time.

Product behavior, data sources, and limits live in the repo root [README.md](../README.md) and [docs/limitations.md](../docs/limitations.md). This folder is not a separate product.
