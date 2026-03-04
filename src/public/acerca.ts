/**
 * Ejemplo de ruta dinámica
 * Accesible en: gemini://localhost/acerca
 */

export default async function() {
  const now = new Date();
  
  return `# Acerca de este servidor

Este es un servidor Gemini construido con TypeScript.

## Información del servidor
* Fecha actual: ${now.toLocaleDateString('es-ES')}
* Hora: ${now.toLocaleTimeString('es-ES')}
* Timestamp: ${now.getTime()}

## Características
* Soporte para archivos estáticos
* Templates Handlebars en archivos .gmi
* Rutas dinámicas con TypeScript/JavaScript
* Detección automática de charset

=> / Volver al inicio
`;
}
