# SLS Pack

Browser-based SLS packing and slicing prototype inspired by Formlabs PreForm.

## Features

- Three.js build-volume viewer for Fuse 1 and Fuse X1 style volumes
- Cannon-based drop, collision, settle, and shake simulation
- Add one part, add a batch, fill the build volume, clear, repack, and shake
- Upload STL or OBJ models
- Fill Volume duplicates the selected uploaded model, or the first uploaded model in the build
- Layer slider clips the model stack and draws real mesh-plane intersections
- FPS counter, raster resolution, LOD, occlusion culling, and metallic shader controls
- Packing simulation runs in a Web Worker so the UI can keep rendering

## Custom Model Workflow

1. Click `Clear`.
2. Click `Upload` and choose one `.stl` or `.obj`.
3. Let the model drop and settle.
4. Click `Fill Volume`.

When an uploaded model exists, `Fill Volume` clones that uploaded model instead of generating sample parts. Existing parts stay in their current packed positions while the new copies drop in from above.

## Development

```bash
npm install
npm run dev
```

The dev server is available at the URL printed by Vite, normally `http://localhost:5173/`.

## Build

```bash
npm run build
```

The production build is written to `dist/`.

## GitHub Pages

This repo includes a GitHub Actions workflow at `.github/workflows/deploy.yml`.

To enable deployment:

1. Push the repo to GitHub.
2. In repository settings, enable Pages.
3. Set the Pages source to `GitHub Actions`.
4. Push to `main` or run the workflow manually.

The Vite build uses relative asset paths so it can run from a GitHub Pages project URL.
