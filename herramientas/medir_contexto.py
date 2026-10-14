"""Mide cuánto contexto entra en cada llamada y cuánto cuesta, SIN llamar a la IA (gratis, sin API key).

Uso (desde la raíz del repositorio):
    python herramientas/medir_contexto.py
    $env:PRICE_IN="..."     (USD por millón de tokens de ENTRADA, de Google AI Studio)  -> agrega costos
    python herramientas/medir_contexto.py --llamadas-mes 100000

Los tokens son una ESTIMACIÓN (≈ 1 token cada 3,6 caracteres en español). Para el número exacto agregue --exacto
con GEMINI_API_KEY definida: usa el endpoint de conteo de tokens de Gemini.
"""
import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from recuperar import RAIZ, Indice, formatear, fragmentos  # noqa: E402

CHARS_POR_TOKEN = 3.6
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")


def est(texto):
    return round(len(texto) / CHARS_POR_TOKEN)


def contar_tokens_exacto(system, contenido, api_key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:countTokens"
    cuerpo = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": contenido}]}],
    }
    solicitud = urllib.request.Request(
        url,
        data=json.dumps(cuerpo).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(solicitud, timeout=30) as respuesta:
        return int(json.load(respuesta)["totalTokens"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--llamadas-mes", type=int, default=100_000)
    ap.add_argument("--exacto", action="store_true")
    a = ap.parse_args()

    prompt_ts = (RAIZ / "prompts" / "responder.system.ts").read_text(encoding="utf-8")
    system = prompt_ts.split("`", 1)[1].rsplit("`", 1)[0]
    frags = fragmentos(incluir_obsoletos=False)
    idx = Indice(frags)
    pregunta = "<pregunta>\nRedacta un correo para pedir una reunión sobre el Proyecto Aurora.\n</pregunta>"
    estrategias = {
        "A. Sin documentos": "<documentos>\n</documentos>",
        "B. Todos los documentos": formatear([(1, f) for f in frags]),
        "C. 3 fragmentos recuperados": formatear(idx.buscar("correo reunión Proyecto Aurora disponibilidad", 3)),
    }
    p_in = os.environ.get("PRICE_IN")
    print(f"{'Estrategia':<30}{'Tokens entrada':>16}{'Veces vs C':>12}" + ("   Costo entrada/mes (USD)" if p_in else ""))
    base = est(system + estrategias["C. 3 fragmentos recuperados"] + pregunta)
    for nombre, docs in estrategias.items():
        t = est(system + docs + pregunta)
        if a.exacto and os.environ.get("GEMINI_API_KEY"):
            t = contar_tokens_exacto(system, docs + pregunta, os.environ["GEMINI_API_KEY"])
        fila = f"{nombre:<30}{t:>16}{t / base:>11.1f}x"
        if p_in:
            fila += f"   {t / 1e6 * float(p_in) * a.llamadas_mes:>12,.2f}"
        print(fila)
    print(f"\nSupuestos: {a.llamadas_mes:,} llamadas al mes; solo cuenta la ENTRADA (la salida es similar en las tres).")
    print("La recuperación mantiene pequeño el contexto porque solo envía los fragmentos relacionados con la consulta.")


if __name__ == "__main__":
    main()
