// evaluate_file.cjs
// Uso: node evaluate_file.cjs <carpeta_transcripciones> <archivo_presentacion>
// node evaluate_file.cjs ./transcripts ./presentacion.pdf

const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
dotenv.config();

const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL;

const modelo = "google/gemini-2.5-pro";

// Carpeta de transcripciones
const transcripcionesDir = process.argv[2] || "./transcripts";
const presentacionPath = process.argv[3];
// opcional: job id pasado desde el pipeline para asociar la evaluación
const jobId = process.argv[4] || null;

// uso: node evaluate_file.cjs <carpeta_transcripciones> <archivo_presentacion> [jobId]

// Extrae el texto visual de la presentación usando extract_presentation_text.cjs
function leerPresentacion(presentacionPath) {
  if (!presentacionPath) return '';
  try {
    // Ejecuta el script externo y obtiene el texto
    const { execSync } = require('child_process');
    const output = execSync(`node ./extract_presentation_text.cjs "${presentacionPath}"`, { encoding: 'utf-8' });
    return output.trim();
  } catch (err) {
    console.error('No se pudo extraer el texto de la presentación:', err.message);
    return '';
  }
}

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

// IMPORTANT: When asking the AI to evaluate for storage in the DB we need
// a strict JSON output matching the `evaluations` table. We request a
// JSON object with per-criterion scores and per-criterion comments, plus
// an overall summary. We'll store `scores` in the `scores` JSONB column
// and serialize the comments+summary into the `notes` TEXT column.
// Required JSON schema:
// {
//   "scores": {
//     "clarity_coherence": <1-7>,
//     "technical_advances": <1-7>,
//     "user_value": <1-7>,
//     "demo_quality": <1-7>,
//     "oral_presentation": <1-7>
//   },
//   "total_score": <number>,
//   "comments": {
//     "clarity_coherence": "<comment>",
//     "technical_advances": "<comment>",
//     "user_value": "<comment>",
//     "demo_quality": "<comment>",
//     "oral_presentation": "<comment>"
//   },
//   "summary": "<short final summary>"
// }
// The script will parse this JSON and save `scores` and `total_score` into
// the DB; `comments` + `summary` will be stored in `notes` as a JSON string.
const promptJsonInstruction = `\n\nIMPORTANTE: Devuelve SOLO un único objeto JSON válido sin explicaciones ni texto adicional. El JSON debe tener la forma:\n{\n  "scores": { "clarity_coherence": <1-7>, "technical_advances": <1-7>, "user_value": <1-7>, "demo_quality": <1-7>, "oral_presentation": <1-7> },\n  "total_score": <number>,\n  "comments": { "clarity_coherence": "<comentario>", "technical_advances": "<comentario>", "user_value": "<comentario>", "demo_quality": "<comentario>", "oral_presentation": "<comentario>" },\n  "summary": "<resumen final>"\n}\nCalcula \"total_score\" como el promedio ponderado usando los pesos: 25,25,20,15,15 (mantén la escala 1-7).`; 

async function evaluarTranscripcion() {
  const transcripcion = leerTranscripciones(transcripcionesDir);
  const textoPresentacion = leerPresentacion(presentacionPath);
  let prompt = promptBase;
  if (textoPresentacion) {
    prompt += `\n\nCONTENIDO VISUAL DE LA PRESENTACIÓN EXTRAÍDO (diapositivas, PDF o PPT):\n${textoPresentacion}`;
  }
  prompt += `\n\nTRANSCRIPCIÓN ORAL:\n${transcripcion}`;
  // append JSON instruction so the model returns structured output we can store
  prompt += promptJsonInstruction;

  console.log("Enviando transcripción y contenido visual a Gemini...\n");

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
    const evaluationText = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : JSON.stringify(data);
    console.log(evaluationText);

    // If we have a jobId try to save evaluation into DB (best-effort)
    if (jobId) {
      try {
        const jobsMetaPath = path.join(process.cwd(), 'jobs', jobId, 'metadata.json');
        let metadata = null;
        try {
          if (fs.existsSync(jobsMetaPath)) {
            metadata = JSON.parse(fs.readFileSync(jobsMetaPath, 'utf-8'));
          }
        } catch (e) {}

        // dynamic import of DB helper (ESM) from CommonJS
        const dbModule = await import('./lib/db.js');
        const db = dbModule.default;
        try {
          await db.init();
        } catch (e) {
          console.error('DB init failed, skipping DB save:', e.message);
        }

        // determine videoId: prefer DB id in metadata, otherwise try lookup by jobExternalId
        let videoId = (metadata && metadata.dbId) ? metadata.dbId : null;
        if (!videoId) {
          try {
            const v = await db.getVideoByJobExternalId(jobId);
            if (v) videoId = v.id;
          } catch (e) {
            // ignore lookup errors, leave videoId null
          }
        }

        if (videoId) {
          // try to parse the AI response as JSON (it should follow the schema requested)
          let parsed = null;
          try {
            parsed = JSON.parse(evaluationText);
          } catch (e) {
            // attempt to extract JSON object from text if the model wrapped it in backticks or markdown
            const first = evaluationText.indexOf('{');
            const last = evaluationText.lastIndexOf('}');
            if (first !== -1 && last !== -1 && last > first) {
              try { parsed = JSON.parse(evaluationText.slice(first, last + 1)); } catch (e2) { parsed = null; }
            }
          }

          const scores = parsed && parsed.scores ? parsed.scores : {};
          const totalScore = parsed && (parsed.total_score || parsed.totalScore) ? (parsed.total_score || parsed.totalScore) : null;

          // Build notes to store: we prefer structured comments + summary
          let notesToStore = null;
          const comments = parsed && parsed.comments ? parsed.comments : (parsed && parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : null);
          const summary = parsed && parsed.summary ? parsed.summary : (parsed && parsed.notes && typeof parsed.notes === 'string' ? parsed.notes : null);
          if (comments || summary) {
            // store as an OBJECT with keys `comments` and `summary` so it is inserted as JSONB
            const payload = { comments: comments || {}, summary: summary || '' };
            notesToStore = payload;
          } else if (parsed && parsed.notes && typeof parsed.notes === 'object') {
            notesToStore = parsed.notes;
          } else if (parsed && parsed.notes && typeof parsed.notes === 'string') {
            // wrap raw string into object so DB column (JSONB NOT NULL) always receives JSON
            notesToStore = { raw: parsed.notes };
          } else {
            // fallback: wrap raw evaluation text
            notesToStore = { raw: evaluationText };
          }

          try {
            await db.insertEvaluation({ videoId, evaluatorId: null, rubricId: null, scores: scores, totalScore: totalScore, notes: notesToStore });
            console.log('Evaluación guardada en la base de datos para videoId=', videoId);
          } catch (e) {
            console.error('Error guardando evaluación en DB:', e.message);
          }
        } else {
          console.warn('No se pudo determinar videoId para jobId', jobId, '- evaluación no guardada en BD.');
        }
      } catch (err) {
        console.error('Error al intentar guardar evaluación en BD:', err && err.message ? err.message : String(err));
      }
    }
  } else {
    console.error(`Error ${response.status}:`, await response.text());
  }
}

evaluarTranscripcion();
