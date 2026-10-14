// probar.mjs — cliente MCP mínimo para verificar el servidor SIN Gemini CLI ni API key.
// Uso: npm run probar     (arranca server.mjs, lista capacidades y llama a cada herramienta)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: process.execPath, args: ["server.mjs"] });
const client = new Client({ name: "probador", version: "1.0.0" });
await client.connect(transport);

const mostrar = (titulo, x) => console.log(`\n=== ${titulo} ===\n${typeof x === "string" ? x : JSON.stringify(x, null, 2)}`);
const texto = (r) => r.content.map((c) => c.text).join("\n");

mostrar("Herramientas", (await client.listTools()).tools.map((t) => `${t.name}: ${t.description.slice(0, 70)}...`));
const recursos = (await client.listResources()).resources;
mostrar("Recursos vigentes", recursos.map((r) => r.uri));
mostrar("Recursos: el obsoleto NO aparece", recursos.some((r) => r.uri.includes("FAQ-2023")) ? "FALLA: aparece FAQ-2023" : "OK");

mostrar("buscar_politica('deducible choque auto')", texto(await client.callTool({ name: "buscar_politica", arguments: { consulta: "deducible choque auto" } })));
mostrar("estado_reclamo('R-1002')", texto(await client.callTool({ name: "estado_reclamo", arguments: { id: "R-1002" } })));
const malo = await client.callTool({ name: "estado_reclamo", arguments: { id: "R-9999" } });
mostrar("estado_reclamo('R-9999') — debe ser error controlado", `isError=${malo.isError} · ${texto(malo)}`);
try {
  const r = await client.callTool({ name: "estado_reclamo", arguments: { id: "1001; DROP TABLE" } });
  mostrar("estado_reclamo con id inválido: rechazado por el esquema", `isError=${r.isError} · ${texto(r).slice(0, 140)}`);
} catch (e) {
  mostrar("estado_reclamo con id inválido: rechazado por el esquema", String(e.message).slice(0, 140));
}
mostrar("Leer recurso andina://politicas/POL-SLA", texto({ content: (await client.readResource({ uri: "andina://politicas/POL-SLA" })).contents }).slice(0, 220) + "...");

await client.close();
