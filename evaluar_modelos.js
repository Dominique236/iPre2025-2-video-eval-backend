import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL;

// Modelos a probar
const modelos = [
  "openai/gpt-4o",
  "meta-llama/llama-3-70b-instruct",
];

// Prompt completo
const prompt = `Quiero que actúes como un evaluador académico especializado en presentaciones de proyectos de software. A continuación, te entregaré una rúbrica detallada y luego la transcripción de una presentación oral.

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

TRANSCRIPCIÓN:
A continuación, se presentarán los avances implementados en la web de SpeedClean.
En primer lugar, voy a empezar con un usuario administrador.
Lo primero que veo a al ingresar es la vista de Dashboard.
Esta vista es un panorama administrativo que entrega una actualización general de lo que ha pasado.
Podemos ver acá un resumen del desempeño de los técnicos,
con la cantidad de órdenes realizadas por cada uno del último mes ordenada de mayor a menor.
Por otro lado, tenemos las reparaciones más urgentes,
que serían las órdenes de trabajo que llevan más tiempo esperando.
Por lo tanto, son máquinas más urgentes de reparar.
Por otro lado, podemos ver las máquinas con más o de acumuladas,
y esto es un resumen de cual son las máquinas más problemáticas,
y donde se encuentran, además de detallar el modelo de estas.
En un futuro, la idea es que esta sección
pueda mostrar información de alguna manera más gráfica,
y con esto puede reconocer fácilmente
cuáles son los edificios críticos para tomar mejores decisiones.
Por último, la información general más relevante
es el porcentaje de máquinas en mal estado,
lo cual indica la fracción de nuestras máquinas que necesitan reparación.
Si presionamos esta sección, nos llevará automáticamente a la vista de máquinas,
con un filtro perecer exionado en aquellas máquinas que se encuentran inactivas.
Si queremos volver a mostrar todas las máquinas,
simplemente limpiamos los filtros
y podemos ver el detalle de tanto las activas como las inactivas
y su modelo proveedor más información necesaria.
Esto sería por parte de la información administrativa.
Si nosotros volvemos a la sección de órdenes
implementada en el ciclo anterior,
podemos ver en conjunto con el usuario técnico
que existe ahora una interacción entre la web y la aplicación móvil.
Cuando el usuario técnico
edite una OT y le agregue subtarías o las cambias de por hacer aderminadas,
esto se podrá haber reflejado en el detalle de cada orden de trabajo
cuando el usuario administrador lo quiera revisar.
Ahora voy a cerrar sesión para volver a ingresar como un usuario de finanzas.
Entonces, ingresamos la cuenta
y tenemos la vista del usuario de finanzas que cuenta con esta nueva sección.
Una labor clave que tengo yo como usuario de finanzas
es poder ingresar manualmente el conteo de las monedas por edificio,
para poder comparar este conteo con los números que las máquinas indican
de lo que fue recaudado.
Lo que antiguamente voy a hacer yo era ingresar en un excel,
el registro de estos conteos por edificio,
y luego compararlos con los números indicados por las máquinas.
Pero había un problema en la consistencia y el orden de los datos.
Por lo tanto, esto es un dolor para la empresa
porque los números deben calzar y deben ser también fáciles de comparar.
Entonces, lo que antiguamente se hacía en el excel,
ahora yo lo voy a poder hacer en la sección de finanzas
en el registro de conteos.
Vamos a seleccionar el edificio Vista Santa María para probar.
Y a fecha de hoy, vamos a simular el ingreso de 300 monedas de 100,
250 monedas de 500 y 8.000 monedas de 50.
Vamos a ingresar este número y la información fue enviada correctamente.
Podemos notar que este botón se encuentra bloqueado para que,
en caso de error, no tengamos que sobrecargar la página.
Luego, si nos vamos a la sección de diferencias de conteo,
y seleccionamos nuevamente el edificio Vista Santa María.
Podemos ver que existe un conteo manual,
el número que acabamos de ingresar, comparado con un conteo en máquina.
Este número, conteo en máquina, como llegó acá.
El usuario recaudador desde la aplicación muy,
lo que hizo fue tomar imágenes de los ciclos que entregaban las máquinas,
 y estas imágenes fueron procesadas por la inteligencia artificial
y con cierto porcentaje de confianza y de certeza,
se envió un número definitivo para mostrar en la aplicación web.
Podría seleccionar otro edificio, como por ejemplo,
el alarmador vano, el cual tiene una diferencia neta de conteo manual
y conteo máquina de solo 200 pesos.
Esto en diferencia porcentual no alcanza a 0,1%.
Por lo tanto, la fila latabla no se encuentra destacada con color alarmante,
y esto permite al usuario de finanzas poder distinguir entre los casos mas graves.
Con esto, damos por finalizar la presentación de los avances en la aplicación web.
Muchas gracias.
`;

async function probarModelos() {
  for (const modelo of modelos) {
    console.log(`\n=== Resultados con ${modelo} ===\n`);

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
      console.log(data.choices[0].message.content);
    } else {
      console.error(`Error ${response.status}:`, await response.text());
    }
  }
}

probarModelos();
