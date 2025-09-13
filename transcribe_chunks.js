// transcribe_chunks.js
// Uso: node transcribe_chunks.js <carpeta_chunks> <carpeta_salida>
// Requiere tener whisper instalado
// node transcribe_chunks.js ./chunks ./transcripts

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const [,, chunksDir, outputDir] = process.argv;

if (!chunksDir || !outputDir) {
  console.error('Uso: node transcribe_chunks.js <carpeta_chunks> <carpeta_salida>');
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const files = fs.readdirSync(chunksDir).filter(f => f.endsWith('.mp4') || f.endsWith('.mp3'));

for (const file of files) {
  const inputPath = path.join(chunksDir, file);
  try {
    // Ejecuta whisper para transcribir el chunk en español y generar .srt
    execSync(`whisper "${inputPath}" --model small --language Spanish --output_format srt --output_dir "${outputDir}"`, { stdio: 'inherit' });
    console.log(`Transcripción completada para ${file}`);
  } catch (err) {
    console.error(`Error transcribiendo ${file}:`, err.message);
  }
}
