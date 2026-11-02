# Architecture diagrams

Three diagrams, each stored as an editable Excalidraw file plus rendered copies.

| File | Shows | Used in |
| --- | --- | --- |
| `system-architecture` | Deployed topology: browser, Hosting, Auth, Firestore, Cloud Functions, Scheduler, FCM/Twilio, Storage, Logging | Report Figure 4.1 |
| `reminder-sweep` | The five-minute engine: scope query, four alert classes, deterministic-id dedupe, four delivery channels | Report §7.3 |
| `data-model` | Firestore collections, ownership, and the rules that follow from `userId` | Report Figure 6.1 |

Each base name exists in four formats:

- `.excalidraw` — the editable source. Open at <https://excalidraw.com> via *Menu → Open* (or drag it
  onto the canvas), edit, then *Export → Save to file* to write it back.
- `.svg` — vector copy for slides and the web.
- `.png` — raster preview, rendered at three times the layout size.
- `.pdf` — the copy LaTeX includes. The PNG is placed on a 16 cm-wide page, so the figure is raster in the
  PDF at roughly 580 dpi; text stays sharp at print size.

Do not hand-edit the rendered formats: they are generated.

## Regenerating

The diagrams are drawn through the Excalidraw canvas toolkit
([yctimlin/mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw), MIT), not hand-written JSON.
That buys element-level updates and a headless renderer, so the script can look at its own output and check
it before writing anything to `docs/`.

```bash
npm run diagrams
```

The script starts the canvas server on `127.0.0.1:3931` if nothing is listening, pushes each diagram,
renders PNG and SVG, exports the `.excalidraw`, and rewrites the PDF. It then re-reads the exported scene
and fails the run if a shape overlaps another, a label is wider than its box, an arrow crosses an
unrelated shape, or a text element covers one. Override the endpoint with `EXPRESS_SERVER_URL` and the CLI
entry point with `EXCALIDRAW_CLI`.

### Why the server is loopback-only

The canvas server has no authentication. It binds `127.0.0.1` and is only ever used to draw, so nothing on
the network can reach it. Do not set `HOST=0.0.0.0`, and stop it when you are done:

```bash
npx -y mcp-excalidraw-server@2.1.2 stop
```

### Layout rules the script enforces

- Every shape is sized from Helvetica metrics, so a label never needs to wrap to a line the box cannot hold.
- Zones carry a free-standing text element, never a bound label: a bound label would sit in the middle of
  the zone, on top of its children.
- Arrows are bound to their endpoints wherever the flow is adjacent; the two connectors that have to travel
  around the diagram (the live read back to the SPA, the telemetry write past the fan-out zone) are routed
  by hand along the margin.
- Arrow labels only appear where the gap is wide enough to hold them.

`preview.html` renders all three side by side; serve the folder over HTTP
(`python3 -m http.server`) and open it in a browser.
