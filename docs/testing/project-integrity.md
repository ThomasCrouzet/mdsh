# Project persistence scenarios

These scenarios verify project identity and path integrity across local durability workflows.

## Failure risks

- A reload can remove the project identifier or relative path from a trash entry.
- Restoring a project document can create a duplicate project path.
- A preserved conflict branch can keep the same project path as the active document.
- A queued save can replace a newer durable project path with stale metadata.
- Conflict handling can lose the local content or the durable external branch.
- A recovery copy can lose its project context or relative destinations.
- A project ZIP can omit an asset after a document recovery workflow.

## Browser workflows

Run the focused scenarios with:

```sh
npm run test:e2e -- project-integrity.spec.ts --project=chromium --workers=1
```

The trash scenario removes a project document, reloads the app, and restores it. The exported ZIP must contain its original path and exact image bytes.

The conflict scenario changes a durable project path before a queued editor save. The save must retain the new path and local content. The external branch must use a free sibling path.

The collision scenario replaces a trashed project path before restoration. The replacement must keep the project path. The restored branch must use a free sibling path in the project.

## Evidence

Each scenario attaches a JSON database snapshot or a project ZIP. The Playwright report records the command, source revision, working diff, environment, and result.
