// evaluate_file.js
// Uso: node evaluate_file.js <carpeta_transcripciones>
// node evaluate_file.js ./transcripts

import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
dotenv.config();

const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL;

const modelo = "google/gemini-2.5-pro";

// Carpeta de transcripciones
const transcripcionesDir = process.argv[2] || "./transcripts";

// Lee y concatena solo el texto de todos los .srt de la carpeta (ignora timestamps e IDs)
function leerTranscripciones(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.srt'));
  let textoCompleto = "";
  for (const file of files) {
    const contenido = fs.readFileSync(path.join(dir, file), 'utf-8');
    const lineas = contenido.split(/\r?\n/).filter(linea => {
      return linea.trim() && !/^\d+$/.test(linea.trim()) && !linea.includes('-->');
    });
    textoCompleto += lineas.join(' ') + "\n";
  }
  return textoCompleto;
}

// Prompt base (rúbrica fija para pruebas)
const promptBase = `Quiero que actúes como un evaluador académico especializado en presentaciones de proyectos de software. A continuación, te entregaré una rúbrica detallada y luego la transcripción de una presentación oral.

RÚBRICA:
Claridad y Coherencia de la Presentación (25%)

La exposición tiene una estructura lógica y clara.
El presentador explica adecuadamente el flujo de la plataforma (dashboard, módulos, transiciones).
Se entiende el propósito de cada funcionalidad mostrada.

Avances Técnicos Implementados (25%)

Se presentan funcionalidades efectivamente nuevas (interacción con móvil, filtros, ingreso de datos financieros).
Se evidencia una mejora respecto al ciclo anterior.
La funcionalidad es demostrada correctamente durante la presentación.

Valor para los Usuarios (20%)

Se explica el beneficio que cada nuevo módulo entrega a perfiles específicos (administrador, técnico, finanzas).
Se justifica cómo los cambios resuelven problemas reales (consistencia de datos, control de recaudación, monitoreo de fallas).

Calidad de la Demostración (15%)

La demo muestra un flujo fluido y sin errores técnicos evidentes.
Se interactúa correctamente con las vistas clave (dashboard, órdenes, máquinas, finanzas).
Las interacciones web/móvil se entienden y funcionan.

Presentación Oral y Manejo del Discurso (15%)

El presentador se expresa con claridad, confianza y ritmo adecuado.
Uso de un lenguaje comprensible para una audiencia técnica y no técnica.
Se mantiene el interés durante toda la presentación.

Por favor, evalúa la transcripción usando esta rúbrica. Para cada criterio, indica:
Una puntuación de 1 a 7 (donde 7 es excelente y 1 deficiente)
Un breve comentario justificando la nota
`;

async function evaluarTranscripcion() {
  const transcripcion = leerTranscripciones(transcripcionesDir);
  const prompt = `${promptBase}\nTRANSCRIPCIÓN:\n${transcripcion}`;

  console.log("Enviando transcripción concatenada a Gemini...\n");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: modelo,
      messages: [
        { role: "user", content: prompt }
      ]
    })
  });

  if (response.ok) {
    const data = await response.json();
    console.log("\n=== Evaluación de Gemini ===\n");
    console.log(data.choices[0].message.content);
  } else {
    console.error(`Error ${response.status}:`, await response.text());
  }
}

evaluarTranscripcion();
