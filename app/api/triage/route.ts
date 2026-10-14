// app/api/triage/route.ts (Next.js App Router, desplegado en Vercel)
// La clave GEMINI_API_KEY vive solo en variables de entorno del servidor.
import { SYSTEM } from "@/prompts/triage.system";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_INPUT_CHARS = 4000;
const MAX_TOKENS = 600;

const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    categoria: {
      type: "string",
      enum: ["siniestro_auto", "salud", "hogar", "vida", "cobranza_facturacion", "fraude_sospecha", "otro"],
    },
    severidad: { type: "string", enum: ["baja", "media", "alta", "critica"] },
    area: { type: "string", enum: ["Siniestros", "Cobranzas", "Legal", "Antifraude", "Atención"] },
    escalar: { type: "boolean" },
    dias_habiles: { type: "integer", minimum: 0 },
    resumen: { type: "string", description: "Resumen factual de máximo 25 palabras." },
    alerta_inyeccion: { type: "boolean" },
  },
  required: ["categoria", "severidad", "area", "escalar", "dias_habiles", "resumen", "alerta_inyeccion"],
  additionalProperties: false,
};

type RespuestaGemini = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string; status?: string };
};

type Triage = {
  categoria: string;
  severidad: string;
  area: string;
  escalar: boolean;
  dias_habiles: number;
  resumen: string;
  alerta_inyeccion: boolean;
};

// Rate limit ingenuo en memoria: sirve para el taller. En producción real use un almacén compartido.
const hits = new Map<string, number[]>();
function limitado(ip: string, max = 10, ventanaMs = 60_000) {
  const ahora = Date.now();
  const recientes = (hits.get(ip) ?? []).filter((t) => ahora - t < ventanaMs);
  recientes.push(ahora);
  hits.set(ip, recientes);
  return recientes.length > max;
}

function esValido(valor: unknown): valor is Triage {
  if (!valor || typeof valor !== "object") return false;
  const o = valor as Record<string, unknown>;
  return (
    typeof o.categoria === "string" &&
    ["siniestro_auto", "salud", "hogar", "vida", "cobranza_facturacion", "fraude_sospecha", "otro"].includes(o.categoria) &&
    typeof o.severidad === "string" &&
    ["baja", "media", "alta", "critica"].includes(o.severidad) &&
    typeof o.area === "string" &&
    ["Siniestros", "Cobranzas", "Legal", "Antifraude", "Atención"].includes(o.area) &&
    typeof o.escalar === "boolean" &&
    Number.isInteger(o.dias_habiles) &&
    (o.dias_habiles as number) >= 0 &&
    typeof o.resumen === "string" &&
    o.resumen.length <= 200 &&
    typeof o.alerta_inyeccion === "boolean"
  );
}

async function clasificar(apiKey: string, reclamo: string, fechaPresentacion: string) {
  const hoy = new Date().toISOString().slice(0, 10); // El código pone la fecha, nunca el usuario.
  return fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `<contexto>fecha_hoy: ${hoy}\nfecha_presentacion: ${fechaPresentacion}</contexto>\n<reclamo>\n${reclamo}\n</reclamo>`,
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: MAX_TOKENS,
        thinkingConfig: { thinkingLevel: "low" },
        responseFormat: {
          text: {
            mimeType: "APPLICATION_JSON",
            schema: TRIAGE_SCHEMA,
          },
        },
      },
    }),
  });
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limitado(ip)) return Response.json({ error: "rate_limit" }, { status: 429 });

  const { reclamo, fecha_presentacion } = await req.json().catch(() => ({}));
  if (typeof reclamo !== "string" || !reclamo.trim() || reclamo.length > MAX_INPUT_CHARS) {
    return Response.json({ error: "input_invalido" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_presentacion ?? "")) {
    return Response.json({ error: "fecha_invalida" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Falta la variable de entorno GEMINI_API_KEY.");
    return Response.json({ error: "configuracion_api" }, { status: 500 });
  }

  for (let intento = 1; intento <= 2; intento++) {
    const respuestaApi = await clasificar(apiKey, reclamo, fecha_presentacion);
    const datos = (await respuestaApi.json().catch(() => ({}))) as RespuestaGemini;

    if (!respuestaApi.ok) {
      console.error(
        "Error de Gemini",
        JSON.stringify({
          status: respuestaApi.status,
          tipo: datos.error?.status,
          mensaje: datos.error?.message,
        }),
      );
      return Response.json({ error: "api_modelo" }, { status: 502 });
    }

    console.log(
      JSON.stringify({
        evento: "triage",
        modelo: MODEL,
        intento,
        in: datos.usageMetadata?.promptTokenCount ?? 0,
        out: datos.usageMetadata?.candidatesTokenCount ?? 0,
        total: datos.usageMetadata?.totalTokenCount ?? 0,
      }),
    );

    const texto = datos.candidates?.[0]?.content?.parts
      ?.map((parte) => parte.text ?? "")
      .join("")
      .trim();
    if (!texto) {
      console.error("Gemini no devolvió contenido", {
        bloqueo: datos.promptFeedback?.blockReason,
        fin: datos.candidates?.[0]?.finishReason,
      });
      continue;
    }

    const salida: unknown = (() => {
      try {
        return JSON.parse(texto);
      } catch {
        return null;
      }
    })();
    if (esValido(salida)) return Response.json(salida);
  }

  return Response.json({ error: "salida_invalida" }, { status: 502 });
}
