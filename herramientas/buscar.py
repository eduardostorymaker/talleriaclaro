"""Demo de una sola consulta (gratis, sin IA, sin clave): muestra qué documentos de correo entrarían al contexto.

Uso:
    python herramientas/buscar.py "Redacta un correo para pedir una reunión sobre el Proyecto Aurora"
    python herramientas/buscar.py "¿Qué prioridad tiene este correo sospechoso?"
    python herramientas/buscar.py "..." --sin-sinonimos --k 5
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from recuperar import Indice, expandir, fragmentos  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("pregunta")
ap.add_argument("--k", type=int, default=3)
ap.add_argument("--con-obsoletos", action="store_true", help="incluye documentos marcados como obsoletos")
ap.add_argument("--sin-sinonimos", action="store_true")
a = ap.parse_args()

consulta = a.pregunta if a.sin_sinonimos else expandir(a.pregunta)
res = Indice(fragmentos(incluir_obsoletos=a.con_obsoletos)).buscar(consulta, a.k)
if consulta != a.pregunta:
    print(f"Consulta expandida: {consulta}\n")
if not res:
    print("Sin resultados: el asistente debería responder 'no tengo esa información'.")
for puntaje, f in res:
    print(f"[{puntaje:.2f}] {f['doc']} v{f['version']} · {f['titulo']}  ({f['estado']})\n        {f['texto'][:200]}\n")
