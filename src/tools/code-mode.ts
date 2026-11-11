import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { encodeCatalog } from "../spec/catalog";
import { createEncodeApiFetch } from "../lib/api-adapter";
import type { ScreenEnv } from "../lib/screen";
import { encodeResponse } from "../lib/tool-result";

interface CodeModeEnv extends ScreenEnv {
    ENCODE_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createEncodeApiFetch(env);
    const registrar = { tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        const handler = rest.pop() as (args: unknown, extra: unknown) => ReturnType<Parameters<typeof encodeResponse>[0]>;
        const respond = (args: unknown, extra: unknown) => encodeResponse(() => handler(args, extra), env, String(name), extra, args);
        register(name, ...rest, respond);
        register(`mcp_${String(name)}`, ...rest, respond);
    } };

    const searchTool = createSearchTool({
        prefix: "encode",
        catalog: encodeCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "encode",
        // Verifiable provenance: encode_execute results carry a _meta.citation.
        source: { id: "encode", name: "ENCODE", url: "https://www.encodeproject.org" },
        catalog: encodeCatalog,
        apiFetch,
        maxInlineBytes: 30 * 1024,
        stagingThreshold: 30 * 1024,
        preserveApiErrors: true,
        timeout: 90_000,
        doNamespace: env.ENCODE_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(registrar);
}
