import { loadGtfs } from "./adapters/gtfs-loader.js";
import { createMcpServer, startStdio } from "./adapters/mcp-server.js";

async function main(): Promise<void> {
  const t0 = Date.now();
  const gtfs = await loadGtfs();
  const server = createMcpServer(gtfs);
  console.error(`[zssk-mcp] ready in ${Date.now() - t0}ms (feed=${gtfs.feedVersion})`);
  await startStdio(server);
}

main().catch((err) => {
  console.error("[zssk-mcp] fatal:", err);
  process.exit(1);
});
