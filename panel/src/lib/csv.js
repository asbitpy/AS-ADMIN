// Celda de CSV (separador ';') segura: entre comillas si trae ; " o saltos
// de línea, y con un apóstrofo adelante si empieza con = + - @ (Excel lo
// ejecutaría como fórmula — los nombres y notas los escribe cualquiera del
// equipo). Los números pasan tal cual.
export function celdaCSV(valor) {
  if (typeof valor === 'number') return String(valor);
  let texto = String(valor ?? '');
  if (/^[=+\-@]/.test(texto)) texto = `'${texto}`;
  if (/[;"\r\n]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

export function armarCSV(filas) {
  return '﻿' + filas.map((fila) => fila.map(celdaCSV).join(';')).join('\r\n');
}
