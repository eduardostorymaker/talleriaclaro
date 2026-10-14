// scripts/build-context.mjs — convierte /context/*.md en lib/context.generated.json (un fragmento por sección "## ...").
// Se ejecuta solo antes de cada build (script "prebuild" en package.json) o a mano: node scripts/build-context.mjs
// Uso: node scripts/build-context.mjs [carpeta]   (por defecto ./context)
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? "context");
const salida = path.resolve("lib/context.generated.json");
const fragmentos = [];

for (const archivo of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
  const raw = fs.readFileSync(path.join(dir, archivo), "utf8").replace(/\r\n/g, "\n");
  let meta = {};
  let cuerpo = raw;
  if (raw.startsWith("---")) {
    const [, fm, ...resto] = raw.split("---");
    cuerpo = resto.join("---");
    for (const linea of fm.trim().split("\n")) {
      const i = linea.indexOf(":");
      if (i > 0) meta[linea.slice(0, i).trim()] = linea.slice(i + 1).trim();
    }
  }
  for (const bloque of cuerpo.trim().split(/\n(?=## )/)) {
    if (!bloque.startsWith("## ")) continue;
    const [titulo, ...texto] = bloque.split("\n");
    fragmentos.push({
      doc: meta.id ?? path.basename(archivo, ".md"),
      version: meta.version ?? "?",
      vigente_desde: meta.vigente_desde ?? "?",
      estado: meta.estado ?? "VIGENTE",
      titulo: titulo.slice(3).trim(),
      texto: texto.join("\n").trim(),
    });
  }
}

fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, JSON.stringify(fragmentos, null, 2));
console.log(`context: ${fragmentos.length} fragmentos de ${dir} -> ${salida}`);
