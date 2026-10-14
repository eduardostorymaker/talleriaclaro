# Taller de IA Generativa · Su plataforma en el navegador

No necesita instalar nada ni saber programar: todo se hace en el navegador, y la IA le ayuda a construir.
La guía completa, paso a paso, es el documento Word **"Guía del alumno · Taller de construcción"**.

## 1. Abrir el entorno

1. En la página de este proyecto en GitHub: botón verde **Code → Codespaces → Create codespace**.
2. Espere 2 a 4 minutos la primera vez.
3. Abra la ventana de comandos: menú **Terminal → New Terminal**.

> Si algo no funciona porque falta instalar (por ejemplo, `npm run dev` o `gemini` dan error de "no encontrado"), escriba en la ventana de comandos: `bash instalar.sh` y espere unos minutos.

## 2. Encender la plataforma (solo copiar y pegar)

Abra el archivo `.env` y pegue la clave que le dio el instructor después del signo `=`:

```dotenv
GEMINI_API_KEY=LA-CLAVE
```

- En la ventana de comandos ejecute `npm run dev`.
- La ventana quedará ocupada mostrando mensajes: es normal, **no la cierre**.
- El archivo `.env` está excluido de Git: nunca lo fuerce a un commit ni comparta su contenido.
- En Vercel, agregue `GEMINI_API_KEY` en la configuración de variables de entorno del proyecto.

## 3. Abrir la pantalla

Aparece un aviso de "puerto 3000". Haga clic en **Open in Browser**. Si no lo ve: pestaña **Ports** (abajo) → fila 3000 → ícono del globo.

Verá **"Mi asistente"**. Haga clic en **"Probar: Pregunta normal"** y lea la respuesta, su fuente y los avisos.

## 4. Construir su proyecto con la IA

En una **segunda** ventana de comandos (signo `+`), escriba:

```bash
gemini
```

Gemini CLI es su ayudante: usted le pide cosas en español y él escribe y cambia los archivos. Siga la guía del alumno (Word).

Primer pedido, para comprobar que entiende el proyecto:

> Lee GEMINI.md y explícame en 5 líneas cómo está organizado este proyecto. No cambies nada.

## Reglas

1. La clave solo se guarda en `.env` local o en las variables de entorno de Vercel. Nunca en código, commits ni chats.
2. El saldo de la clave es limitado y compartido: pruebas cortas.
3. Si algo falla, copie el mensaje completo y péguelo a Gemini CLI o pida ayuda en el chat.
4. Antes de terminar, pídale a Gemini CLI: *"Guarda mis cambios y súbelos a GitHub"*.
