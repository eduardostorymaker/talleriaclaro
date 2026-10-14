// app/api/triage/route.ts  (Next.js App Router, desplegado en Vercel)
// La clave ANTHROPIC_API_KEY vive solo en variables de entorno del servidor.
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM } from "@/prompts/triage.system";

const client = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno

const MODEL = "claude-sonnet-5-5"; // decisión del Taller 3: cámbielo según su matriz
const MAX_INPUT_CHARS = 4000;
const MAX_TOKENS = 600;

// Esquema de salida como herramienta: con tool_choice forzado, la estructura es mucho más confiable que pedir JSON en texto.
const TRIAGE_TOOL: Anthropic.Tool = {
  name: "registrar_triage",
  description: "Registra la clasificación del reclamo.",
  input_schema: {
    type: "object",
    properties: {
      categoria: { type: "string", enum: ["siniestro_auto", "salud", "hogar", "vida", "cobranza_facturacion", "fraude_sospecha", "otro"] },
      severidad: { type: "string", enum: ["baja", "media", "alta", "critica"] },
      area: { type: "string", enum: ["Siniestros", "Cobranzas", "Legal", "Antifraude", "Atención"] },
      escalar: { type: "boolean" },
      dias_habiles: { type: "integer", minimum: 0 },
      resumen: { type: "string", maxLength: 200 },
      alerta_inyeccion: { type: "boolean" },
    },
    required: ["categoria", "severidad", "area", "escalar", "dias_habiles", "resumen", "alerta_inyeccion"],
  },
};

// Rate limit ingenuo en memoria: sirve para el taller. En producción real use un almacén compartido (Vercel KV / Upstash),
// porque cada instancia serverless tiene su propia memoria.
const hits = new Map<string, number[]>();
function limitado(ip: string, max = 10, ventanaMs = 60_000) {
  const ahora = Date.now();
  const recientes = (hits.get(ip) ?? []).filter((t) => ahora - t < ventanaMs);
  recientes.push(ahora);
  hits.set(ip, recientes);
  return recientes.length > max;
}

function esValido(o: any) {
  return (
    o &&
    ["baja", "media", "alta", "critica"].includes(o.severidad) &&
    typeof o.escalar === "boolean" &&
    typeof o.alerta_inyeccion === "boolean" &&
    Number.isInteger(o.dias_habiles)
  );
}

async function clasificar(reclamo: string, fechaPresentacion: string) {
  const hoy = new Date().toISOString().slice(0, 10); // el CÓDIGO pone la fecha, nunca el usuario
  return client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    tools: [TRIAGE_TOOL],
    tool_choice: { type: "tool", name: "registrar_triage" },
    messages: [
      {
        role: "user",
        content: `<contexto>fecha_hoy: ${hoy}\nfecha_presentacion: ${fechaPresentacion}</contexto>\n<reclamo>\n${reclamo}\n</reclamo>`,
      },
    ],
  });
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  if (limitado(ip)) return Response.json({ error: "rate_limit" }, { status: 429 });

  const { reclamo, fecha_presentacion } = await req.json().catch(() => ({}));
  if (typeof reclamo !== "string" || !reclamo.trim() || reclamo.length > MAX_INPUT_CHARS)
    return Response.json({ error: "input_invalido" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_presentacion ?? ""))
    return Response.json({ error: "fecha_invalida" }, { status: 400 });

  for (let intento = 1; intento <= 2; intento++) {
    const msg = await clasificar(reclamo, fecha_presentacion);
    const bloque = msg.content.find((b) => b.type === "tool_use");
    // Registro de costo por llamada: tokens reales informados por la API
    console.log(JSON.stringify({ evento: "triage", intento, in: msg.usage.input_tokens, out: msg.usage.output_tokens }));
    if (bloque && bloque.type === "tool_use" && esValido(bloque.input)) return Response.json(bloque.input);
  }
  return Response.json({ error: "salida_invalida" }, { status: 502 });
}
