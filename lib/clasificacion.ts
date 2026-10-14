import reglasData from "@/data/reglas-clasificacion.json";

export type CorreoClasificable = {
  asunto: string;
  cuerpo: string;
  remitente?: string;
};

export type ClasificacionCodigo = {
  metodo: "codigo";
  categoria: { id: string; etiqueta: string } | null;
  prioridad: { id: string; etiqueta: string } | null;
  confianza: number;
  coincidencias: string[];
  explicacion: string;
};

function normalizar(texto: string) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buscarCoincidencias(texto: string, palabras: string[]) {
  return palabras.filter((palabra) => texto.includes(normalizar(palabra)));
}

export function clasificarConReglas(correo: CorreoClasificable): ClasificacionCodigo {
  const asunto = normalizar(correo.asunto);
  const cuerpo = normalizar(`${correo.remitente ?? ""} ${correo.cuerpo}`);
  const { configuracion, categorias, prioridades } = reglasData;

  const candidatas = categorias
    .map((categoria) => {
      const enAsunto = buscarCoincidencias(asunto, categoria.palabras_clave);
      const enCuerpo = buscarCoincidencias(cuerpo, categoria.palabras_clave);
      const puntaje =
        enAsunto.length * configuracion.peso_asunto +
        enCuerpo.length * configuracion.peso_cuerpo;
      return {
        categoria,
        puntaje,
        coincidencias: [...new Set([...enAsunto, ...enCuerpo])],
      };
    })
    .sort((a, b) => b.puntaje - a.puntaje);

  const ganadora = candidatas[0];
  if (!ganadora || ganadora.puntaje < configuracion.puntaje_minimo) {
    return {
      metodo: "codigo",
      categoria: null,
      prioridad: null,
      confianza: 0,
      coincidencias: [],
      explicacion: "Ninguna regla alcanzó el puntaje mínimo. El correo queda sin clasificar.",
    };
  }

  const textoCompleto = `${asunto} ${cuerpo}`;
  const prioridadDetectada = prioridades
    .map((prioridad) => ({
      prioridad,
      coincidencias: buscarCoincidencias(textoCompleto, prioridad.palabras_clave),
    }))
    .find((resultado) => resultado.coincidencias.length > 0);
  const prioridad =
    prioridadDetectada?.prioridad ??
    prioridades.find((item) => item.id === configuracion.prioridad_predeterminada) ??
    prioridades[0];

  const confianza = Math.min(0.98, 0.55 + ganadora.puntaje * 0.06);
  return {
    metodo: "codigo",
    categoria: { id: ganadora.categoria.id, etiqueta: ganadora.categoria.etiqueta },
    prioridad: { id: prioridad.id, etiqueta: prioridad.etiqueta },
    confianza,
    coincidencias: ganadora.coincidencias,
    explicacion: `La regla «${ganadora.categoria.etiqueta}» obtuvo ${ganadora.puntaje} puntos por coincidencias exactas.`,
  };
}
