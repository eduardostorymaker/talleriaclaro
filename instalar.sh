#!/usr/bin/env bash
# instalar.sh — respaldo: instala todo lo que el Codespace instala solo.
# Úselo únicamente si la instalación automática no corrió (por ejemplo, si 'gemini' o 'npm run dev' no funcionan).
# Uso, en la raíz del proyecto (donde está package.json):   bash instalar.sh
set -e

if [ ! -f package.json ]; then
  echo "No veo package.json aquí. Entre a la carpeta del proyecto (la que contiene app, lib y package.json) y repita."
  exit 1
fi

echo "1/3  Instalando el proyecto..."
npm install

echo "2/3  Instalando el servidor de herramientas de ejemplo..."
(cd mcp/servidor-andina && npm install)

echo "3/3  Instalando a su ayudante (Gemini CLI)..."
npm install -g @google/gemini-cli

echo ""
echo "Listo. Ahora escriba:"
echo "  Edite .env y pegue su clave después de GEMINI_API_KEY="
echo "  npm run dev"
