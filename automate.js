// automate.js
// Uso: node automate.js "/ruta/al/audio.mp3" (o video) "/ruta/a/presentacion.pdf"
// Ejecuta split_file.js, transcribe_chunks.js y evaluate_file.js en orden

import { execSync } from 'child_process';

if (process.argv.length < 4) {
  console.error('Uso: node automate.js "/ruta/al/audio.mp3" "/ruta/a/presentacion.pdf"');
  process.exit(1);
}

const audioPath = process.argv[2];
const presentacionPath = process.argv[3];
const chunksDir = './chunks';
const transcriptsDir = './transcripts';

try {
  console.log('1. Dividiendo audio en chunks...');
  execSync(`node split_file.js "${audioPath}" ${chunksDir}`, { stdio: 'inherit' });

  console.log('\n2. Transcribiendo chunks...');
  execSync(`node transcribe_chunks.js ${chunksDir} ${transcriptsDir}`, { stdio: 'inherit' });

  console.log('\n3. Evaluando transcripciones y presentación...');
  execSync(`node evaluate_file.cjs ${transcriptsDir} "${presentacionPath}"`, { stdio: 'inherit' });

  console.log('\nPipeline completado.');
} catch (err) {
  console.error('Error en el pipeline:', err.message);
  process.exit(1);
}
