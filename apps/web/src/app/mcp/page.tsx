"use client";

import CrudPanel from "@/components/CrudPanel";

export default function McpPage() {
  return (
    <div>
      <h1 className="page-title">MCP 서버</h1>
      <p className="page-desc">
        Model Context Protocol 서버를 등록합니다. 프로젝트에 연결하면 해당 도구가 에이전트에 노출됩니다.
      </p>
      <CrudPanel
        endpoint="/mcp"
        title="MCP 서버"
        columns={[
          {
            key: "id",
            label: "id",
            render: (r) => <span className="mono">{String(r.id).slice(0, 8)}</span>,
          },
          { key: "name", label: "이름" },
          { key: "type", label: "타입" },
          {
            key: "target",
            label: "대상",
            render: (r) => (
              <span className="mono">
                {r.type === "stdio"
                  ? `${r.command ?? ""} ${((r.args as string[]) ?? []).join(" ")}`
                  : String(r.url ?? "")}
              </span>
            ),
          },
          {
            key: "enabled",
            label: "활성",
            render: (r) =>
              r.enabled ? (
                <span className="badge ok">ON</span>
              ) : (
                <span className="badge queued">OFF</span>
              ),
          },
        ]}
        fields={[
          { name: "name", label: "이름", required: true, placeholder: "github" },
          {
            name: "type",
            label: "타입",
            type: "select",
            required: true,
            defaultValue: "stdio",
            options: [
              { value: "stdio", label: "stdio (로컬 명령)" },
              { value: "http", label: "http" },
              { value: "sse", label: "sse" },
            ],
          },
          { name: "command", label: "명령 (stdio)", placeholder: "npx" },
          {
            name: "args",
            label: "인자 (콤마 구분, stdio)",
            type: "csv",
            placeholder: "-y, @modelcontextprotocol/server-github",
            full: true,
          },
          {
            name: "url",
            label: "URL (http/sse)",
            placeholder: "https://mcp.example.com",
            full: true,
          },
          { name: "enabled", label: "활성화", type: "checkbox", defaultValue: true },
        ]}
      />
    </div>
  );
}
