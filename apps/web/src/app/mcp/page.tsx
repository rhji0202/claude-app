"use client";

import CrudPanel from "@/components/CrudPanel";
import { PageHeader } from "@/components/PageHeader";
import { Mono } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";

export default function McpPage() {
  return (
    <div>
      <PageHeader title="MCP 서버">
        Model Context Protocol 서버를 등록합니다. 프로젝트에 연결하면 해당 도구가 에이전트에 노출됩니다.
      </PageHeader>
      <CrudPanel
        endpoint="/mcp"
        title="MCP 서버"
        columns={[
          {
            key: "id",
            label: "id",
            render: (r) => <Mono>{String(r.id).slice(0, 8)}</Mono>,
          },
          { key: "name", label: "이름" },
          { key: "type", label: "타입" },
          {
            key: "target",
            label: "대상",
            render: (r) => (
              <Mono>
                {r.type === "stdio"
                  ? `${r.command ?? ""} ${((r.args as string[]) ?? []).join(" ")}`
                  : String(r.url ?? "")}
              </Mono>
            ),
          },
          {
            key: "enabled",
            label: "활성",
            render: (r) =>
              r.enabled ? (
                <Badge variant="success">ON</Badge>
              ) : (
                <Badge variant="muted">OFF</Badge>
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
