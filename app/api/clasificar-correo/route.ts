import correosData from "@/data/correos-prueba.json";
import reglasData from "@/data/reglas-clasificacion.json";
import { SYSTEM_CLASIFICAR_CORREO } from "@/prompts/clasificar-correo.system";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_ID_CHARS = 80;
const MAX_TOKENS = 350;

type CorreoPrueba = {
  id: string;
  formato: string;
  remitente: string;
  asunto: string;
  fecha: string;
  cuerpo: string;
};

type SalidaGemini = {
  categoria: string;
  prioridad: string;
  confianza: number;
  razones: string[];
};

type RespuestaGemini = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string; status?: string };
};

const correos = correosData as CorreoPrueba[];
const categoriasPermitidas = [...reglasData.categorias.map((categoria) => categoria.id), "otro"];
const prioridadesPermitidas = reglasData.prioridades.map((prioridad) => prioridad.id);

const RESPUESTA_SCHEMA = {
  type: "object",
  properties: {
    categoria: { type: "string", enum: categoriasPermitidas },
    prioridad: { type: "string", enum: prioridadesPermitidas },
    confianza: { type: "number", minimum: 0, maximum: 1 },
    razones: {
      type: "array",
      maxItems: 2,
      items: { type: "string", maxLength: 180 },
    },
  },
  required: ["categoria", "prioridad", "confianza", "razones"],
  additionalProperties: false,
};

const hits = new Map<string, number[]>();
function limitado(ip: string, max = 10, ventanaMs = 60_000) {
  const ahora = Date.now();
  const recientes = (hits.get(ip) ?? []).filter((momento) => ahora - momento < ventanaMs);
  recientes.push(ahora);
  hits.set(ip, recientes);
  return recientes.length > max;
}

function esSalidaValida(valor: unknown): valor is SalidaGemini {
  if (!valor || typeof valor !== "object") return false;
  const salida = valor as Record<string, unknown>;
  return (
    typeof salida.categoria === "string" &&
    categoriasPermitidas.includes(salida.categoria) &&
    typeof salida.prioridad === "string" &&
    prioridadesPermitidas.includes(salida.prioridad) &&
    typeof salida.confianza === "number" &&
    salida.confianza >= 0 &&
    salida.confianza <= 1 &&
    Array.isArray(salida.razones) &&
    salida.razones.length <= 2 &&
    salida.razones.every((razon) => typeof razon === "string" && razon.length <= 180)
  );
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limitado(ip)) return Response.json({ error: "rate_limit" }, { status: 429 });

  const { correo_id } = await req.json().catch(() => ({}));
  if (
    typeof correo_id !== "string" ||
    !correo_id.trim() ||
    correo_id.length > MAX_ID_CHARS ||
    !/^[a-z0-9-]+$/.test(correo_id)
  ) {
    return Response.json({ error: "input_invalido" }, { status: 400 });
  }

  const correo = correos.find((item) => item.id === correo_id);
  if (!correo) return Response.json({ error: "correo_no_encontrado" }, { status: 404 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Falta la variable de entorno GEMINI_API_KEY.");
    return Response.json({ error: "configuracion_api" }, { status: 500 });
  }

  const catalogo = reglasData.categorias.map(({ id, etiqueta, descripcion }) => ({
    id,
    etiqueta,
    descripcion,
  }));
  const rubricaPrioridad = reglasData.prioridades.map(({ id, etiqueta, descripcion }) => ({
    id,
    etiqueta,
    descripcion,
  }));
  const correoParaModelo = {
    formato: correo.formato,
    remitente: correo.remitente,
    asunto: correo.asunto,
    fecha: correo.fecha,
    cuerpo: correo.cuerpo,
  };

  try {
    const respuestaApi = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_CLASIFICAR_CORREO }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  `<catalogo>${JSON.stringify(catalogo)}</catalogo>\n` +
                  `<prioridades>${JSON.stringify(rubricaPrioridad)}</prioridades>\n` +
                  `<correo>${JSON.stringify(correoParaModelo)}</correo>`,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: MAX_TOKENS,
          thinkingConfig: { thinkingLevel: "minimal", includeThoughts: false },
          responseFormat: {
            text: {
              mimeType: "APPLICATION_JSON",
              schema: RESPUESTA_SCHEMA,
            },
          },
        },
      }),
    });

    const datos = (await respuestaApi.json().catch(() => ({}))) as RespuestaGemini;
    if (!respuestaApi.ok) {
      console.error(
        "Error de Gemini al clasificar correo",
        JSON.stringify({
          status: respuestaApi.status,
          tipo: datos.error?.status,
          mensaje: datos.error?.message,
        }),
      );
      return Response.json({ error: "api_modelo" }, { status: 502 });
    }

    const texto = datos.candidates?.[0]?.content?.parts
      ?.map((parte) => parte.text ?? "")
      .join("")
      .trim();
    const salida: unknown = (() => {
      try {
        return texto ? JSON.parse(texto) : null;
      } catch {
        return null;
      }
    })();

    if (!esSalidaValida(salida)) {
      return Response.json({ error: "salida_invalida" }, { status: 502 });
    }

    const categoria =
      reglasData.categorias.find((item) => item.id === salida.categoria)?.etiqueta ?? "Otro";
    const prioridad =
      reglasData.prioridades.find((item) => item.id === salida.prioridad)?.etiqueta ??
      salida.prioridad;

    console.log(
      JSON.stringify({
        evento: "clasificar_correo_gemini",
        modelo: MODEL,
        correo_id,
        in: datos.usageMetadata?.promptTokenCount ?? 0,
        out: datos.usageMetadata?.candidatesTokenCount ?? 0,
        total: datos.usageMetadata?.totalTokenCount ?? 0,
      }),
    );

    return Response.json({
      metodo: "gemini",
      categoria: { id: salida.categoria, etiqueta: categoria },
      prioridad: { id: salida.prioridad, etiqueta: prioridad },
      confianza: salida.confianza,
      razones: salida.razones,
    });
  } catch (error) {
    console.error("Error al conectar con Gemini para clasificar correo", error);
    return Response.json({ error: "api_modelo" }, { status: 502 });
  }
}
