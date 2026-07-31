#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { startHttpServer } from './http.js';
import { buildMcpServer } from './mcp.js';
import { SigningService } from './service.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const service = new SigningService(config);
  await service.initialize();

  const http = await startHttpServer(service);
  const mcp = buildMcpServer(service);
  const transport = new StdioServerTransport();

  process.stderr.write(`SSIG approval terminal: ${service.approvalUrl()}\n`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await mcp.close().catch(() => undefined);
    await new Promise<void>((resolve) => http.server.close(() => resolve()));
  };

  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
  process.stdin.once('end', () => void shutdown());

  await mcp.connect(transport);
}

main().catch((error: unknown) => {
  process.stderr.write(`SSIG fatal error: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
