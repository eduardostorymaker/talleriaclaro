"use client";

import { useMemo, useState } from "react";
import correosData from "@/data/correos-prueba.json";
import { clasificarConReglas, type ClasificacionCodigo } from "@/lib/clasificacion";
import styles from "./ComparadorClasificacion.module.css";

type CorreoPrueba = {
  id: string;
  formato: string;
  remitente: string;
  asunto: string;
  fecha: string;
  cuerpo: string;
  caso_control?: boolean;
};

type ClasificacionGemini = {
  metodo: "gemini";
  categoria: { id: string; etiqueta: string };
  prioridad: { id: string; etiqueta: string };
  confianza: number;
  razones: string[];
};

const MENSAJES_ERROR: Record<string, string> = {
  rate_limit: "Se alcanzó el límite de consultas. Espera un minuto e inténtalo nuevamente.",
  input_invalido: "El correo seleccionado no es válido.",
  correo_no_encontrado: "El correo de prueba ya no está disponible.",
  configuracion_api: "Falta configurar GEMINI_API_KEY en Vercel o en el archivo .env.",
  api_modelo: "Gemini no está disponible en este momento.",
  salida_invalida: "Gemini devolvió una clasificación con un formato inesperado.",
};

function fechaLegible(fecha: string) {
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Lima",
  }).format(new Date(fecha));
}

function Confianza({ valor }: { valor: number }) {
  const porcentaje = Math.round(valor * 100);
  return (
    <div className={styles.confidence} aria-label={`Confianza: ${porcentaje} %`}>
      <span><i style={{ width: `${porcentaje}%` }} /></span>
      <strong>{porcentaje} %</strong>
    </div>
  );
}

export default function ComparadorClasificacion({ onClose }: { onClose: () => void }) {
  const correos = correosData as CorreoPrueba[];
  const [correoId, setCorreoId] = useState(correos[0]?.id ?? "");
  const [resultadoCodigo, setResultadoCodigo] = useState<ClasificacionCodigo | null>(null);
  const [resultadoGemini, setResultadoGemini] = useState<ClasificacionGemini | null>(null);
  const [cargandoGemini, setCargandoGemini] = useState(false);
  const [errorGemini, setErrorGemini] = useState("");

  const correo = useMemo(
    () => correos.find((item) => item.id === correoId) ?? correos[0],
    [correoId, correos],
  );

  function seleccionar(id: string) {
    setCorreoId(id);
    setResultadoCodigo(null);
    setResultadoGemini(null);
    setErrorGemini("");
  }

  function clasificarCodigo() {
    if (!correo) return;
    setResultadoCodigo(clasificarConReglas(correo));
  }

  async function clasificarGemini() {
    if (!correo || cargandoGemini) return;
    setCargandoGemini(true);
    setErrorGemini("");
    setResultadoGemini(null);
    try {
      const respuesta = await fetch("/api/clasificar-correo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo_id: correo.id }),
      });
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) {
        setErrorGemini(MENSAJES_ERROR[datos.error] ?? "No se pudo clasificar con Gemini.");
        return;
      }
      setResultadoGemini(datos as ClasificacionGemini);
    } catch {
      setErrorGemini("No se pudo conectar con el clasificador de Gemini.");
    } finally {
      setCargandoGemini(false);
    }
  }

  if (!correo) return null;

  return (
    <section className={styles.panel} aria-labelledby="titulo-comparador">
      <header className={styles.header}>
        <div>
          <p>Laboratorio de clasificación</p>
          <h2 id="titulo-comparador">Compara reglas fijas con Gemini</h2>
          <span>Selecciona un correo y ejecuta ambos métodos para revisar sus diferencias.</span>
        </div>
        <button type="button" onClick={onClose} className={styles.closeButton} aria-label="Cerrar comparador">
          ×
        </button>
      </header>

      <div className={styles.content}>
        <aside className={styles.emailList} aria-label="Correos de prueba">
          <div className={styles.listHeading}>
            <strong>Correos de prueba</strong>
            <span>{correos.length}</span>
          </div>
          {correos.map((item) => (
            <button
              type="button"
              key={item.id}
              className={item.id === correo.id ? styles.emailSelected : styles.emailOption}
              onClick={() => seleccionar(item.id)}
              aria-pressed={item.id === correo.id}
            >
              <span className={styles.emailFormat}>
                {item.formato}
                {item.caso_control ? <i>Caso de control</i> : null}
              </span>
              <strong>{item.asunto}</strong>
              <small>{item.remitente}</small>
            </button>
          ))}
        </aside>

        <div className={styles.analysisArea}>
          <article className={styles.emailPreview}>
            <div className={styles.emailMeta}>
              <div><span>De</span><strong>{correo.remitente}</strong></div>
              <div><span>Fecha</span><strong>{fechaLegible(correo.fecha)}</strong></div>
            </div>
            <h3>{correo.asunto}</h3>
            <div className={styles.emailBody}>{correo.cuerpo}</div>
          </article>

          {correo.caso_control ? (
            <div className={styles.controlNote}>
              <strong>Muestra de control</strong>
              <p>Este correo no contiene palabras incluidas en las reglas. El código debería dejarlo sin clasificar.</p>
            </div>
          ) : null}

          <div className={styles.actionGrid}>
            <button type="button" onClick={clasificarCodigo} className={styles.codeButton}>
              <span>{"{ }"}</span>
              Clasificar con código
            </button>
            <button
              type="button"
              onClick={clasificarGemini}
              className={styles.geminiButton}
              disabled={cargandoGemini}
            >
              <span>{cargandoGemini ? <i className={styles.spinner} /> : "✦"}</span>
              {cargandoGemini ? "Consultando Gemini…" : "Clasificar con Gemini"}
            </button>
          </div>

          {errorGemini ? <div className={styles.apiError} role="alert">{errorGemini}</div> : null}

          <div className={styles.resultsGrid} aria-live="polite">
            <article className={styles.resultCard}>
              <div className={styles.resultTitle}>
                <span className={styles.codeMark}>{"{ }"}</span>
                <div><strong>Reglas fijas</strong><small>Resultado determinista</small></div>
              </div>
              {resultadoCodigo ? (
                resultadoCodigo.categoria ? (
                  <div className={styles.resultBody}>
                    <div className={styles.labels}>
                      <span>{resultadoCodigo.categoria.etiqueta}</span>
                      <span data-priority={resultadoCodigo.prioridad?.id}>{resultadoCodigo.prioridad?.etiqueta}</span>
                    </div>
                    <Confianza valor={resultadoCodigo.confianza} />
                    <p>{resultadoCodigo.explicacion}</p>
                    <div className={styles.matches}>
                      <small>Coincidencias</small>
                      <div>{resultadoCodigo.coincidencias.map((item) => <span key={item}>{item}</span>)}</div>
                    </div>
                  </div>
                ) : (
                  <div className={styles.noMatch}>
                    <strong>Sin clasificar</strong>
                    <p>{resultadoCodigo.explicacion}</p>
                  </div>
                )
              ) : (
                <p className={styles.emptyResult}>Ejecuta la clasificación por código.</p>
              )}
            </article>

            <article className={styles.resultCard}>
              <div className={styles.resultTitle}>
                <span className={styles.geminiMark}>✦</span>
                <div><strong>Gemini</strong><small>Comprensión semántica</small></div>
              </div>
              {resultadoGemini ? (
                <div className={styles.resultBody}>
                  <div className={styles.labels}>
                    <span>{resultadoGemini.categoria.etiqueta}</span>
                    <span data-priority={resultadoGemini.prioridad.id}>{resultadoGemini.prioridad.etiqueta}</span>
                  </div>
                  <Confianza valor={resultadoGemini.confianza} />
                  <div className={styles.reasons}>
                    <small>Razones</small>
                    <ul>{resultadoGemini.razones.map((razon) => <li key={razon}>{razon}</li>)}</ul>
                  </div>
                </div>
              ) : (
                <p className={styles.emptyResult}>
                  {cargandoGemini ? "Gemini está analizando el correo…" : "Ejecuta la clasificación con Gemini."}
                </p>
              )}
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
