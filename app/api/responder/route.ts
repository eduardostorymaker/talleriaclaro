// app/api/responder/route.ts (Next.js App Router, desplegado en Vercel)
// Pregunta -> recuperar fragmentos -> llamar a Gemini con los fragmentos como contexto -> respuesta con fuentes.
// La clave GEMINI_API_KEY vive solo en variables de entorno del servidor.
import { SYSTEM } from "@/prompts/responder.system";
import { buscar, expandir, formatear } from "@/lib/retrieval";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`;
const MAX_INPUT_CHARS = 1000;
const MAX_TOKENS = 800;
const K = 3; // Fragmentos que entran como contexto: la perilla que decide costo y precisión.

// Gemini usa este esquema para devolver el mismo formato que ya consume app/page.tsx.
const RESPUESTA_SCHEMA = {
  type: "object",
  properties: {
    respuesta: {
      type: "string",
      description: "Resumen, clasificación o borrador de correo de máximo 180 palabras.",
    },
    fuentes: {
      type: "array",
      description: "Ids de las fuentes utilizadas.",
      items: { type: "string" },
    },
    suficiente_contexto: { type: "boolean" },
    alerta_inyeccion: { type: "boolean" },
  },
  required: ["respuesta", "fuentes", "suficiente_contexto", "alerta_inyeccion"],
  additionalProperties: false,
};

type RespuestaGemini = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
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

type RespuestaEstructurada = {
  respuesta: string;
  fuentes: string[];
  suficiente_contexto: boolean;
  alerta_inyeccion: boolean;
};

function esRespuestaEstructurada(valor: unknown): valor is RespuestaEstructurada {
  if (!valor || typeof valor !== "object") return false;
  const r = valor as Record<string, unknown>;
  return (
    typeof r.respuesta === "string" &&
    r.respuesta.length <= 1400 &&
    Array.isArray(r.fuentes) &&
    r.fuentes.every((fuente) => typeof fuente === "string") &&
    typeof r.suficiente_contexto === "boolean" &&
    typeof r.alerta_inyeccion === "boolean"
  );
}

// Rate limit ingenuo en memoria (válido para el taller; en producción use un almacén compartido).
const hits = new Map<string, number[]>();
function limitado(ip: string, max = 10, ventanaMs = 60_000) {
  const ahora = Date.now();
  const recientes = (hits.get(ip) ?? []).filter((t) => ahora - t < ventanaMs);
  recientes.push(ahora);
  hits.set(ip, recientes);
  return recientes.length > max;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limitado(ip)) return Response.json({ error: "rate_limit" }, { status: 429 });

  const { pregunta } = await req.json().catch(() => ({}));
  if (typeof pregunta !== "string" || !pregunta.trim() || pregunta.length > MAX_INPUT_CHARS) {
    return Response.json({ error: "input_invalido" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Falta la variable de entorno GEMINI_API_KEY.");
    return Response.json({ error: "configuracion_api" }, { status: 500 });
  }

  // 1. Recuperar: el código decide qué entra al contexto (nunca el usuario).
  const encontrados = buscar(expandir(pregunta), K);
  const contexto = formatear(encontrados);

  const codificador = new TextEncoder();
  const flujo = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enviar = (evento: object) => {
        controller.enqueue(codificador.encode(`${JSON.stringify(evento)}\n`));
      };

      try {
        enviar({ tipo: "estado", mensaje: "Buscando documentos relevantes…" });
        enviar({
          tipo: "estado",
          mensaje: `${encontrados.length} fragmentos relevantes encontrados.`,
        });
        enviar({ tipo: "estado", mensaje: "Gemini está analizando la información…" });

        const respuestaApi = await fetch(GEMINI_URL, {
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
                parts: [{ text: `${contexto}\n<pregunta>\n${pregunta}\n</pregunta>` }],
              },
            ],
            generationConfig: {
              maxOutputTokens: MAX_TOKENS,
              thinkingConfig: { thinkingLevel: "low", includeThoughts: true },
              responseFormat: {
                text: {
                  mimeType: "APPLICATION_JSON",
                  schema: RESPUESTA_SCHEMA,
                },
              },
            },
          }),
        });

        if (!respuestaApi.ok) {
          const error = (await respuestaApi.json().catch(() => ({}))) as RespuestaGemini;
          console.error(
            "Error de Gemini",
            JSON.stringify({
              status: respuestaApi.status,
              tipo: error.error?.status,
              mensaje: error.error?.message,
            }),
          );
          enviar({ tipo: "error", error: "api_modelo" });
          return;
        }

        if (!respuestaApi.body) {
          enviar({ tipo: "error", error: "salida_invalida" });
          return;
        }

        const lector = respuestaApi.body.getReader();
        const decodificador = new TextDecoder();
        let buffer = "";
        let textoFinal = "";
        let resumenPensamiento = "";
        let uso: RespuestaGemini["usageMetadata"];

        const procesarBloque = (bloque: string) => {
          const data = bloque
            .split(/\r?\n/)
            .filter((linea) => linea.startsWith("data:"))
            .map((linea) => linea.slice(5).trimStart())
            .join("\n");
          if (!data) return;

          const fragmento = JSON.parse(data) as RespuestaGemini;
          uso = fragmento.usageMetadata ?? uso;
          for (const parte of fragmento.candidates?.[0]?.content?.parts ?? []) {
            if (!parte.text) continue;
            if (parte.thought) {
              resumenPensamiento += parte.text;
              enviar({ tipo: "pensamiento", texto: parte.text });
            } else {
              textoFinal += parte.text;
            }
          }
        };

        while (true) {
          const { done, value } = await lector.read();
          if (done) break;
          buffer += decodificador.decode(value, { stream: true });
          const bloques = buffer.split(/\r?\n\r?\n/);
          buffer = bloques.pop() ?? "";
          for (const bloque of bloques) procesarBloque(bloque);
        }
        buffer += decodificador.decode();
        if (buffer.trim()) procesarBloque(buffer);

        enviar({ tipo: "estado", mensaje: "Validando la respuesta y sus fuentes…" });

        const salida: unknown = (() => {
          try {
            return JSON.parse(textoFinal.trim());
          } catch {
            return null;
          }
        })();

        if (!esRespuestaEstructurada(salida)) {
          enviar({ tipo: "error", error: "salida_invalida" });
          return;
        }

        console.log(
          JSON.stringify({
            evento: "responder",
            modelo: MODEL,
            in: uso?.promptTokenCount ?? 0,
            out: uso?.candidatesTokenCount ?? 0,
            total: uso?.totalTokenCount ?? 0,
            fragmentos: encontrados.map((r) => `${r.fragmento.doc}/${r.fragmento.titulo}`),
          }),
        );

        enviar({
          tipo: "resultado",
          datos: {
            ...salida,
            contexto_usado: encontrados.map((r) => r.fragmento.doc),
            resumen_pensamiento:
              resumenPensamiento.trim() ||
              "Gemini no proporcionó un resumen del razonamiento para esta respuesta.",
          },
        });
      } catch (error) {
        console.error("Error durante el streaming de Gemini", error);
        try {
          enviar({ tipo: "error", error: "api_modelo" });
        } catch {
          // El navegador pudo cerrar la conexión antes de recibir el error.
        }
      } finally {
        try {
          controller.close();
        } catch {
          // La conexión ya estaba cerrada.
        }
      }
    },
  });

  return new Response(flujo, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
