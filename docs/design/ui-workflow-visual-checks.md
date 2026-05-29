# UI Workflow And Visual Checks

Use these commands for AEQI UI work in a throwaway worktree:

```bash
npm run ui:wt -- doctor /home/claudedev/aeqi-ui-work --repair
npm run ui:wt -- dev /home/claudedev/aeqi-ui-work --port auto --api prod
npm run visual:check:list
npm run visual:check -- role-detail --base http://127.0.0.1:5173 --layout --require-auth
```

The contract:

- `ui:wt` owns dependency symlinks and dev-server startup for UI worktrees.
- `visual:check` owns named routes and expected text/selectors.
- `visual:route` remains the low-level escape hatch and the only place that seeds auth.
- `--assert-layout` is for structural checks that screenshots alone miss.
- Inspector/detail rows and metadata pills should come from the `InspectorPanel` primitive family before adding page-local CSS.
