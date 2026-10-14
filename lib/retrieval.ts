// lib/retrieval.ts — recuperación BM25 sobre fragmentos. Mismo algoritmo que eval/recuperar.py,
// para que los resultados del examen en Python coincidan con los del producto.
// Los fragmentos vienen de lib/context.generated.json, que genera scripts/build-context.mjs a partir de /context/*.md
import generado from "./context.generated.json";

export type Fragmento = {
  doc: string;
  version: string;
  vigente_desde: string;
  estado: string;
  titulo: string;
  texto: string;
};

const STOP = new Set(
  "a al algo ante con como cual cuales cuando cuanto cuantos cuanta de del debe deben desde donde el ella en es esta este hay la las le lo los me mi mis mas muy no o para pero por que se si sin sobre su sus te tengo un una uno y ya hace hacen tiene tienen puedo puede voy van fue son ser".split(
    " ",
  ),
);

export function normalizar(t: string) {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function tokens(t: string) {
  const out: string[] = [];
  for (const w of normalizar(t).match(/[a-z0-9]+/g) ?? []) {
    if (STOP.has(w) || (w.length < 3 && !/^\d+$/.test(w))) continue;
    out.push(w.slice(0, 6)); // raíz tosca: 'reembolsa' y 'reembolso' coinciden
  }
  return out;
}

export const FRAGMENTOS: Fragmento[] = generado as Fragmento[];

const K1 = 1.5;
const B = 0.75;

function construir(frags: Fragmento[]) {
  const toks = frags.map((f) => tokens(`${f.titulo} ${f.titulo} ${f.texto}`)); // el título pesa doble
  const avg = toks.reduce((a, t) => a + t.length, 0) / toks.length;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = frags.length;
  const idf = new Map<string, number>();
  for (const [w, d] of df) idf.set(w, Math.log(1 + (n - d + 0.5) / (d + 0.5)));
  return { toks, avg, idf };
}

export function buscar(consulta: string, k = 3, opciones: { incluirObsoletos?: boolean } = {}) {
  const frags = opciones.incluirObsoletos ? FRAGMENTOS : FRAGMENTOS.filter((f) => f.estado !== "OBSOLETO");
  const { toks, avg, idf } = construir(frags);
  const q = tokens(consulta);
  const puntajes = toks.map((t) => {
    const c = new Map<string, number>();
    for (const w of t) c.set(w, (c.get(w) ?? 0) + 1);
    let s = 0;
    for (const w of q) {
      const f = c.get(w);
      if (f) s += ((idf.get(w) ?? 0) * f * (K1 + 1)) / (f + K1 * (1 - B + (B * t.length) / avg));
    }
    return s;
  });
  return puntajes
    .map((p, i) => ({ puntaje: p, fragmento: frags[i] }))
    .filter((r) => r.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, k);
}

// Glosario de expansión: si el cliente usa otra palabra, se agregan las de la política (ver eval/sinonimos.json).
export const EXPANSIONES: Record<string, string[]> = {
  cita: ["reunión", "horario", "disponibilidad"],
  juntarnos: ["reunión", "horario", "disponibilidad"],
  reunión: ["horario", "disponibilidad", "confirmación"],
  urgente: ["prioridad", "plazo", "seguridad"],
  importancia: ["prioridad", "clasificación", "acción"],
  contestar: ["respuesta", "borrador", "correo"],
  responder: ["respuesta", "borrador", "correo"],
  redacta: ["borrador", "estructura", "asunto", "tono"],
  redactar: ["borrador", "estructura", "asunto", "tono"],
  resumir: ["resumen", "propósito", "acción", "fecha"],
  resumen: ["propósito", "acción", "fecha", "compromiso"],
  sospechoso: ["seguridad", "enlace", "remitente", "credenciales"],
  phishing: ["seguridad", "enlace", "remitente", "credenciales"],
  contraseña: ["seguridad", "privacidad", "credenciales"],
  hoy: ["prioridad", "urgente", "24 horas", "mismo día"],
  seguimiento: ["mensaje anterior", "acción pendiente", "plazo"],
  extensión: ["ampliación", "plazo", "entrega"],
};

export function expandir(consulta: string) {
  const extra: string[] = [];
  for (const w of consulta.toLowerCase().match(/[a-záéíóúñ]+/g) ?? []) extra.push(...(EXPANSIONES[w] ?? []));
  return extra.length ? `${consulta} ${extra.join(" ")}` : consulta;
}

// Cómo se presentan los fragmentos al modelo: cada uno con su fuente, versión y vigencia.
export function formatear(resultados: { fragmento: Fragmento }[]) {
  const bloques = resultados.map(
    ({ fragmento: f }) =>
      `<fragmento fuente="${f.doc}" seccion="${f.titulo}" version="${f.version}" vigente_desde="${f.vigente_desde}" estado="${f.estado}">\n${f.texto}\n</fragmento>`,
  );
  return `<documentos>\n${bloques.join("\n")}\n</documentos>`;
}
