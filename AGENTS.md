# Project Rules

- Project version: 1.0.0.
- The active implementation spans `prototype-1.0.0/` and `server/`.
- Architecture and subsystem design references are under `docs/`.
- The active rule source is the external V9.7 registry; configure `OE_V97_REGISTRY_DIR` when the default registry location is unavailable.
- Use `npm test` for backend regression; external-service cases may skip when the service is unavailable.
- Use `npm run server` for the API, `npm run web` for the frontend, and `npm run` for the combined launcher.
- `docker-compose.yml` is the production-shaped local deployment contract; deployment evidence is documented under `docs/ops/`.
- Keep data, feature, and rule layers separated in the prototype.
- Mock data and placeholder behavior must be labeled as such.
- Do not describe the prototype's confidence score as production accuracy or ROI.
- Preserve architecture and subsystem design documents as the evolving 1.0.0 baseline and implementation contract.
- Use semantic versions for future revisions; do not create parallel version directories.
- Run `node --check` on changed JavaScript files and verify local HTML assets before handoff.
