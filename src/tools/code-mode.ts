import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { encodeCatalog } from "../spec/catalog";
import { createEncodeApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    ENCODE_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createEncodeApiFetch();

    const searchTool = createSearchTool({
        prefix: "encode",
        catalog: encodeCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "encode",
        catalog: encodeCatalog,
        apiFetch,
        doNamespace: env.ENCODE_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
