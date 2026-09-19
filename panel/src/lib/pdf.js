// Exporta una tabla a PDF. jsPDF se carga recién al tocar "Exportar PDF"
// (import dinámico), así no suma peso al panel para quien nunca lo usa.
export async function descargarPDF({ titulo, subtitulo, encabezados, filas, totales, nombreArchivo, columnasNumericas = [] }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const margen = 36;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(titulo, margen, 44);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(110);
  if (subtitulo) doc.text(subtitulo, margen, 60);
  doc.text(`Generado el ${new Date().toLocaleDateString('es-PY')}`, doc.internal.pageSize.getWidth() - margen, 44, {
    align: 'right',
  });

  const alineadas = Object.fromEntries(columnasNumericas.map((i) => [i, { halign: 'right' }]));

  autoTable(doc, {
    startY: 76,
    head: [encabezados],
    body: filas,
    foot: totales ? [totales] : undefined,
    margin: { left: margen, right: margen },
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: [8, 14, 42], textColor: 255 },
    footStyles: { fillColor: [235, 235, 240], textColor: 20, fontStyle: 'bold' },
    columnStyles: alineadas,
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`Página ${doc.getNumberOfPages()}`, doc.internal.pageSize.getWidth() - margen, doc.internal.pageSize.getHeight() - 18, {
        align: 'right',
      });
    },
  });

  doc.save(nombreArchivo);
}
