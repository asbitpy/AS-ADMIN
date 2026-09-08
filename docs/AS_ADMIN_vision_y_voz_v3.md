# AS ADMIN — Addendum v3: Visión (imágenes/video) + Agente de voz para llamadas

Este documento se suma al árbol de conversación v2. No lo reemplaza — agrega dos módulos nuevos y actualiza el roadmap y los planes.

> **Antes de leer esto:** no tengo búsqueda web disponible en este momento, y las capacidades/precios exactos de telefonía de ElevenLabs cambian rápido. Todo lo referido a esa integración puntual conviene **verificarlo en la documentación oficial de ElevenLabs antes de diseñar el sistema final o cotizarlo a un cliente.**

---

## Módulo A — Identificación de imágenes y video

### Por qué conviene separarlo del clasificador de texto
Cuando llega una imagen o un video, **no se lo pasás al mismo paso que interpreta texto** — se manda a un paso de visión aparte (Claude puede analizar imágenes directamente). Mezclarlo con el clasificador de texto genera respuestas menos precisas; separarlo mantiene cada paso simple y confiable.

### Categorías y qué hace el bot con cada una

| Qué llega | Cómo lo clasifica el bot | Acción |
|---|---|---|
| **Comprobante de pago / transferencia** | Detecta que es un comprobante bancario/billetera | Extrae monto y fecha, lo asocia al turno pendiente de seña, marca "pago recibido — a confirmar" y **notifica al dueño para que lo verifique** (nunca confirma pago 100% solo, hasta tener el flujo probado) |
| **Documento médico / estudio** | Detecta que es un documento clínico | **No describe ni interpreta el contenido.** Solo responde "Documento recibido, se lo paso a [profesional] 👍", lo adjunta al perfil del cliente y deriva a humano |
| **Foto de referencia** (ej. corte de pelo deseado, estado de un objeto a reparar — para rubros futuros) | Detecta que es una imagen de referencia visual | La guarda como adjunto del turno para que el profesional la vea antes de atender |
| **Video** | No se analiza el contenido en profundidad en v1 (pesado y poco confiable todavía) | Acusa recibo, deriva a humano; opcionalmente guarda un fotograma como miniatura para el panel |
| **Meme / foto sin relación / error** | Detecta que no aporta información útil | Respuesta breve y genérica, no se guarda como dato relevante |

### Regla de privacidad (importante, se suma a lo ya definido con Ley 6534)
Las imágenes de documentos médicos son datos sensibles. Definir desde el diseño:
- **Quién puede ver** esas imágenes en el panel (solo el profesional, no todo el staff)
- **Cuánto tiempo se guardan** antes de poder eliminarse
- Que el bot **nunca** intente resumir o diagnosticar lo que ve en un estudio médico — solo lo etiqueta y deriva

### Nota técnica
- Un mensaje con imagen dispara: 1) guardar el archivo, 2) llamar a Claude con la imagen para clasificarla, 3) ejecutar la acción de la tabla de arriba según la categoría devuelta.
- Los comprobantes de pago conviene tratarlos con más cuidado al principio: mejor que el sistema **sugiera** "parece un pago de Gs. X" y el dueño confirme con un toque, que confirmarlo solo y arriesgar un error de lectura.

---

## Módulo B — Agente de voz para llamadas telefónicas (ElevenLabs)

### La idea
Si alguien **llama** en vez de escribir por WhatsApp, en vez de que suene y nadie atienda, un agente de voz con IA contesta, sigue básicamente el mismo "cerebro" que el bot de WhatsApp (agendar, precios, ubicación, derivar a humano), pero conversando por voz con la síntesis de ElevenLabs.

### Piezas que hacen falta (a alto nivel)
1. **Un número que reciba llamadas entrantes.** Puede ser el fijo actual del negocio con desvío de llamadas, o un número nuevo contratado a través de un proveedor de telefonía en la nube (el más usado para este tipo de integración es Twilio, que sí soporta líneas de Paraguay/la región vía número virtual).
2. **El agente conversacional de ElevenLabs**, configurado con las mismas reglas que el bot de texto: nunca hablar de temas médicos, siempre poder derivar a un humano, tono definido por negocio.
3. **La conexión entre el proveedor de telefonía y el agente de voz.** Esto se resuelve distinto según cómo lo ofrezca ElevenLabs en el momento de implementarlo (integración directa, o vía SIP/Twilio) — **este es el punto que hay que confirmar en la documentación oficial actualizada antes de prometerle esto a un cliente**, porque es una integración más nueva y cambia seguido.
4. **Transferencia real de llamada a un humano** cuando el agente no puede resolver algo — no alcanza con "colgar y que te llamen después", el cliente espera que lo pasen con alguien en el momento si hace falta.

### Por qué conviene construirlo después, no en el mismo lanzamiento
- Suma una capa de complejidad (telefonía + reconocimiento de voz + latencia) que el bot de texto no tiene.
- El costo es distinto: los agentes de voz de ElevenLabs se cobran por minuto de conversación, no es gratis como buena parte del volumen de WhatsApp — conviene tenerlo modelado en el precio antes de ofrecerlo.
- Tiene más sentido una vez que el "cerebro" (reglas, servicios, horarios, límites) ya está probado y funcionando bien en texto — ahí simplemente se lo conecta a un canal de voz en vez de reinventar la lógica.

### Cómo se vende esto
Como un **complemento**, no como parte del plan base: útil sobre todo para negocios que reciben muchas llamadas fuera de horario o pierden clientes porque no atienden el teléfono a tiempo. Encaja bien como upsell del "Plan Full" para quien ya tiene el bot de WhatsApp funcionando y quiere cubrir también el teléfono.

---

## Roadmap actualizado

1. **Fase 1:** Agenda + WhatsApp (texto) — como ya está definido
2. **Fase 2:** Finanzas simples
3. **Fase 3:** Inventario opcional
4. **Fase 4 (nueva):** Visión — identificación de comprobantes de pago y documentos por imagen
5. **Fase 5 (nueva, opcional/premium):** Agente de voz para llamadas telefónicas vía ElevenLabs

No conviene mezclar las fases 4 y 5 con el lanzamiento del piloto — son mejoras que se venden una vez que el cliente piloto ya confía en el sistema base.

## Planes actualizados (para referencia)
- **Plan Básico:** agenda + WhatsApp (texto)
- **Plan Negocio:** + control financiero + identificación de comprobantes de pago
- **Plan Full:** + inventario opcional + identificación de documentos/fotos
- **Add-on Voz:** agente de llamadas telefónicas (se cotiza aparte, cobro asociado al consumo por minuto)
