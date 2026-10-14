// server.mjs — Servidor MCP de Aseguradora Andina (transporte stdio).
// Expone tres capacidades a cualquier cliente MCP (Gemini CLI, etc.):
//   · recurso   andina://politicas/{id}   -> el texto completo de una política (la IA o el usuario lo leen)
//   · herramienta buscar_politica         -> busca fragmentos por palabras clave (solo lectura)
//   · herramienta estado_reclamo          -> consulta el estado de un reclamo (datos de ejemplo, solo lectura)
// IMPORTANTE: stdout es el canal del protocolo; todo mensaje de depuración va a stderr (console.error).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_POLITICAS = process.env.POLITICAS_DIR ?? path.resolve(AQUI, "../../context");
const RECLAMOS = JSON.parse(fs.readFileSync(path.join(AQUI, "datos/reclamos.json"), "utf8"));

// ---------- carga de políticas ----------
function cargar() {
  const docs = [];
  for (const archivo of fs.readdirSync(DIR_POLITICAS).filter((f) => f.endsWith(".md")).sort()) {
    const raw = fs.readFileSync(path.join(DIR_POLITICAS, archivo), "utf8").replace(/\r\n/g, "\n");
    const meta = {};
    let cuerpo = raw;
    if (raw.startsWith("---")) {
      const [, fm, ...resto] = raw.split("---");
      cuerpo = resto.join("---").trim();
      for (const l of fm.trim().split("\n")) {
        const i = l.indexOf(":");
        if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim();
      }
    }
    const secciones = cuerpo.split(/\n(?=## )/).filter((b) => b.startsWith("## "))
      .map((b) => ({ titulo: b.split("\n")[0].slice(3).trim(), texto: b.split("\n").slice(1).join("\n").trim() }));
    docs.push({ id: meta.id ?? archivo, meta, cuerpo, secciones });
  }
  return docs;
}
const DOCS = cargar();
const vigentes = () => DOCS.filter((d) => d.meta.estado !== "OBSOLETO");

const norm = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const toks = (t) => (norm(t).match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2).map((w) => w.slice(0, 6));

// ---------- servidor ----------
const server = new McpServer({ name: "andina", version: "1.0.0" });

server.registerResource(
  "politica",
  new ResourceTemplate("andina://politicas/{id}", {
    list: async () => ({
      resources: vigentes().map((d) => ({
        uri: `andina://politicas/${d.id}`,
        name: d.id,
        description: `${d.cuerpo.split("\n")[0].replace("# ", "")} (v${d.meta.version}, vigente desde ${d.meta.vigente_desde})`,
        mimeType: "text/markdown",
      })),
    }),
  }),
  { title: "Política de Andina", description: "Texto completo de una política vigente", mimeType: "text/markdown" },
  async (uri, { id }) => {
    const d = vigentes().find((x) => x.id === id);
    if (!d) throw new Error(`Política no encontrada o no vigente: ${id}`);
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: d.cuerpo }] };
  },
);

server.registerTool(
  "buscar_politica",
  {
    title: "Buscar en las políticas de Andina",
    description:
      "Busca fragmentos de las políticas vigentes de Aseguradora Andina (coberturas, plazos, cobranza, salud). " +
      "Usar ANTES de responder cualquier pregunta sobre qué cubre o cuánto tarda algo. Devuelve fragmentos con su fuente.",
    inputSchema: { consulta: z.string().min(3).max(300), max_resultados: z.number().int().min(1).max(5).default(3) },
    annotations: { readOnlyHint: true },
  },
  async ({ consulta, max_resultados }) => {
    const q = new Set(toks(consulta));
    const hallazgos = [];
    for (const d of vigentes())
      for (const s of d.secciones) {
        const t = toks(`${s.titulo} ${s.titulo} ${s.texto}`);
        const puntaje = t.filter((w) => q.has(w)).length;
        if (puntaje > 0) hallazgos.push({ puntaje, d, s });
      }
    hallazgos.sort((a, b) => b.puntaje - a.puntaje);
    const top = hallazgos.slice(0, max_resultados);
    if (!top.length) return { content: [{ type: "text", text: "Sin resultados en las políticas vigentes." }] };
    const texto = top
      .map(({ d, s }) => `[fuente: ${d.id} v${d.meta.version} · ${s.titulo}]\n${s.texto}`)
      .join("\n\n");
    return { content: [{ type: "text", text: texto }] };
  },
);

server.registerTool(
  "estado_reclamo",
  {
    title: "Consultar estado de un reclamo",
    description:
      "Devuelve el estado de un reclamo por su id (formato R-1001). Solo lectura. Datos de ejemplo del taller. " +
      "No devuelve datos personales: únicamente estado, área y fechas.",
    inputSchema: { id: z.string().regex(/^R-\d{4}$/, "Formato esperado: R-1001") },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => {
    const r = RECLAMOS.find((x) => x.id === id);
    if (!r) return { isError: true, content: [{ type: "text", text: `No existe el reclamo ${id}.` }] };
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  },
);

console.error(`andina-mcp: ${DOCS.length} documentos (${vigentes().length} vigentes) desde ${DIR_POLITICAS}`);
await server.connect(new StdioServerTransport());
