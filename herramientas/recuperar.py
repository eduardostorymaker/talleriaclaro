"""Recuperación mínima de fragmentos (BM25) sobre los documentos del asistente de correo.

Sin dependencias externas. Es el mismo algoritmo que usa api/lib/retrieval.ts, para que los resultados
del taller coincidan con los del producto.
"""
import math
import re
import unicodedata
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
STOP = set("a al algo ante con como cual cuales cuando cuanto cuantos cuanta de del debe deben desde donde el ella en es esta este "
           "hay la las le lo los me mi mis mas muy no o para pero por que se si sin sobre su sus te tengo un una uno y ya "
           "hace hacen tiene tienen puedo puede voy van fue son ser".split())


def normalizar(t):
    t = unicodedata.normalize("NFD", t.lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def tokens(t):
    out = []
    for w in re.findall(r"[a-z0-9]+", normalizar(t)):
        if w in STOP or len(w) < 3 and not w.isdigit():
            continue
        out.append(w[:6])  # raíz tosca: 'reembolsa' y 'reembolso' coinciden
    return out


def leer_documento(ruta):
    raw = ruta.read_text(encoding="utf-8")
    meta, cuerpo = {}, raw
    if raw.startswith("---"):
        _, fm, cuerpo = raw.split("---", 2)
        for linea in fm.strip().splitlines():
            k, _, v = linea.partition(":")
            meta[k.strip()] = v.strip()
    return meta, cuerpo


def fragmentos(carpeta=RAIZ / "context", incluir_obsoletos=True):
    """Un fragmento por sección '## ...'. Cada fragmento conserva documento, versión y vigencia."""
    out = []
    for ruta in sorted(carpeta.glob("*.md")):
        meta, cuerpo = leer_documento(ruta)
        if not incluir_obsoletos and meta.get("estado") == "OBSOLETO":
            continue
        for bloque in re.split(r"\n(?=## )", cuerpo.strip()):
            if not bloque.startswith("## "):
                continue
            titulo, _, texto = bloque.partition("\n")
            out.append({"doc": meta.get("id", ruta.stem), "version": meta.get("version", "?"),
                        "vigente_desde": meta.get("vigente_desde", "?"), "estado": meta.get("estado", "VIGENTE"),
                        "titulo": titulo[3:].strip(), "texto": texto.strip()})
    return out


class Indice:
    def __init__(self, frags, k1=1.5, b=0.75):
        self.frags, self.k1, self.b = frags, k1, b
        self.toks = [tokens(f["titulo"] + " " + f["titulo"] + " " + f["texto"]) for f in frags]  # el título pesa doble
        self.avg = sum(len(t) for t in self.toks) / len(self.toks)
        df = Counter(w for t in self.toks for w in set(t))
        n = len(frags)
        self.idf = {w: math.log(1 + (n - d + 0.5) / (d + 0.5)) for w, d in df.items()}

    def buscar(self, consulta, k=3):
        q = tokens(consulta)
        puntajes = []
        for i, t in enumerate(self.toks):
            c, s = Counter(t), 0.0
            for w in q:
                if w in c:
                    f = c[w]
                    s += self.idf[w] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * len(t) / self.avg))
            puntajes.append(s)
        orden = sorted(range(len(puntajes)), key=lambda i: -puntajes[i])[:k]
        return [(puntajes[i], self.frags[i]) for i in orden if puntajes[i] > 0]


def expandir(consulta, ruta=RAIZ / "herramientas" / "sinonimos.json"):
    """Agrega a la consulta las palabras del glosario cuando el cliente usa otra palabra (vocabulario distinto)."""
    import json
    exp = json.loads(ruta.read_text(encoding="utf-8"))["expansiones"]
    extra = []
    for w in re.findall(r"[a-záéíóúñ]+", consulta.lower()):
        extra += exp.get(w, [])
    return consulta + (" " + " ".join(extra) if extra else "")


def formatear(resultados):
    """Cómo se presentan los fragmentos al modelo: cada uno con su fuente, versión y vigencia."""
    bloques = []
    for _, f in resultados:
        bloques.append(f'<fragmento fuente="{f["doc"]}" seccion="{f["titulo"]}" version="{f["version"]}" '
                       f'vigente_desde="{f["vigente_desde"]}" estado="{f["estado"]}">\n{f["texto"]}\n</fragmento>')
    return "<documentos>\n" + "\n".join(bloques) + "\n</documentos>"
