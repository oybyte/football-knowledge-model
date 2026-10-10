# Project Rules

- Project version: 1.0.0.
- The active implementation spans `prototype-1.0.0/` and `server/`.
- Architecture and subsystem design references are under `docs/`.
- Direction (2026-10-10): match analysis is AI-driven; results are then settled against actual outcomes and precipitated into rules. The V9.7 rule-manual pipeline is retired in production, not deleted.
- The production rule registry is intentionally empty: `server/config/registry-empty` (0 rules), resolved through `OE_V97_REGISTRY_DIR`. Keep the default inside the repository — the previous default pointed outside it and broke every startup when that directory moved.
- `server/test/fixtures/v97-registry/` holds an 88-rule fixture so rule-storage regression still runs. Tests use the fixture; never re-point the default back to the archived external copy.
- AI output is `untrusted` until reviewed; never feed it into the decision chain or present it as a settled conclusion. Review ledgers live in `ledgers/`, candidate-rule proposals in `proposals/`.
- Use `npm test` for backend regression; external-service cases may skip when the service is unavailable.
- Use `npm run server` for the API, `npm run web` for the frontend, and `npm run` for the combined launcher.
- `docker-compose.yml` is the production-shaped local deployment contract; deployment evidence is documented under `docs/ops/`.
- Keep data, feature, and rule layers separated in the prototype.
- Mock data and placeholder behavior must be labeled as such.
- Do not describe the prototype's confidence score as production accuracy or ROI.
- Preserve architecture and subsystem design documents as the evolving 1.0.0 baseline and implementation contract.
- Use semantic versions for future revisions; do not create parallel version directories.
- Run `node --check` on changed JavaScript files and verify local HTML assets before handoff.
