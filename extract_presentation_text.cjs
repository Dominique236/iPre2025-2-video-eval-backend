// Script para extraer texto de presentaciones PDF o PPTX (CommonJS)
// Uso: node extract_presentation_text.cjs <ruta_al_archivo>

const fs = require('fs');
const path = require('path');

async function extractFromPDF(filePath) {
  const pdfParse = require('pdf-parse');
  // Soportar distintas formas de exportación
  let parse = null;
  if (typeof pdfParse === 'function') {
    parse = pdfParse;
  } else if (pdfParse && typeof pdfParse.default === 'function') {
    parse = pdfParse.default;
  } else if (pdfParse && typeof pdfParse.pdfParse === 'function') {
    parse = pdfParse.pdfParse;
  }
  if (!parse) {
    throw new Error('No se pudo encontrar la función de parseo en pdf-parse');
  }
  const dataBuffer = fs.readFileSync(filePath);
  const data = await parse(dataBuffer);
  return data.text;
}

async function extractFromPPTX(filePath) {
  const PPTX2Json = require('pptx2json');
  const parser = new PPTX2Json();
  const json = await parser.toJson(filePath);
  // Buscar los archivos de slides
  const slideKeys = Object.keys(json).filter(k => k.startsWith('ppt/slides/slide'));
  let allText = [];
  for (const key of slideKeys) {
    const slide = json[key];
    // Buscar los textos en el slide (pueden estar en varios niveles)
    const texts = [];
    function extractText(obj) {
      if (typeof obj === 'object') {
        for (const prop in obj) {
          if (prop === 'a:t' && Array.isArray(obj[prop])) {
            texts.push(obj[prop].join(' '));
          } else {
            extractText(obj[prop]);
          }
        }
      }
    }
    extractText(slide);
    allText.push(texts.join(' '));
  }
  return allText.join('\n---\n');
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Debes proporcionar la ruta a un archivo PDF o PPTX');
    process.exit(1);
  }
  const ext = path.extname(filePath).toLowerCase();
  let text = '';
  try {
    if (ext === '.pdf') {
      text = await extractFromPDF(filePath);
    } else if (ext === '.pptx') {
      text = await extractFromPPTX(filePath);
    } else {
      console.error('Formato no soportado. Usa PDF o PPTX.');
      process.exit(1);
    }
    // Imprime el texto extraído
    console.log(text);
  } catch (err) {
    console.error('Error al extraer texto:', err);
    process.exit(1);
  }
}

main();
