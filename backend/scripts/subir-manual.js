require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const supabase = require('../lib/supabase');

// Sube el manual en PowerPoint a un bucket público de Storage, para que
// Configuración pueda ofrecerlo como descarga directa. Uso puntual (se
// corre a mano cuando el manual se actualiza), no es parte del bot.
const BUCKET = 'recursos-publicos';
const ARCHIVO = process.argv[2];
const DESTINO = 'manual-as-admin.pptx';

async function main() {
  if (!ARCHIVO) {
    console.error('Uso: node subir-manual.js <ruta-al-pptx>');
    process.exit(1);
  }

  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets.some((b) => b.name === BUCKET)) {
    const { error: errBucket } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (errBucket) throw errBucket;
    console.log('Bucket creado:', BUCKET);
  }

  const buffer = fs.readFileSync(ARCHIVO);
  const { error: errUpload } = await supabase.storage.from(BUCKET).upload(DESTINO, buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    upsert: true,
  });
  if (errUpload) throw errUpload;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(DESTINO);
  console.log('Subido. URL pública:');
  console.log(data.publicUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
