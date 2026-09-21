# AS ADMIN — Pendientes (actualizado el 2026-09-21)

Todo el desarrollo del panel está terminado y probado. Lo que queda depende de
plata, de trámites externos o de conseguir un cliente. Por ahora no hay
presupuesto para probar el bot en serio, así que **todo lo de esta lista queda
en pausa** hasta poder pagarlo.

## Estado hoy

- Panel: publicado en https://as-admin-coral.vercel.app (más de 15 pantallas,
  escritorio y celular, instalable como app).
- Backend/bot: publicado en Render en plan gratis (se duerme tras 15 minutos).
- Base de datos: Supabase, con las migraciones 001 a 032 aplicadas.
- Tienda de ejemplo (nutricionista): https://asbitpy.github.io/AS-ADMIN/
- Resumen para socios: https://claude.ai/artifact/FuQCu7KNZfX8Hjts8Dt8gF
- El bot funcionó de punta a punta una vez en una prueba controlada, pero **nunca
  se probó con conversaciones reales**.

## 1. Bot y WhatsApp (bloqueado por plata y trámites)

| Pendiente | Qué hace falta | Costo aproximado |
|---|---|---|
| Cargar crédito en la cuenta de Anthropic | Tarjeta en console.anthropic.com → Billing | desde US$5 para empezar |
| Verificación de negocio en Meta | Business Manager de AS BIT, nombre legal, dirección y RUC o factura de servicio. Es el trámite más lento | gratis, tarda días |
| Plantillas de mensajes aprobadas por Meta | Recordatorio 24 hs, recordatorio del mismo día, alerta de stock, derivación a humano, resumen semanal | gratis |
| Pasar el webhook de Meta al backend de Render | Cambiar la URL en Meta y generar un token permanente (el temporal dura 24 h) | gratis |
| Número de WhatsApp propio por cliente | Un número por negocio, registrado en Meta | según el número |
| Pruebas de uso real del bot | 10 a 15 conversaciones: agendar, cancelar, precio, pedido, mensaje ambiguo, cliente enojado | consume crédito de IA |
| Voz, audios e imágenes | Fase futura: transcripción de audios y lectura de fotos | a definir |

## 2. Producción y calidad (bloqueado por plata)

| Pendiente | Detalle | Costo aproximado |
|---|---|---|
| Servidor pago para el backend | Hoy es gratis y se duerme; para clientes reales no sirve (Render pago o Railway) | ~US$5 a 7 al mes |
| Alertas de errores (Sentry) | Aviso por mail cuando algo falla en el panel o el backend | plan gratis |
| Aviso si el servidor se cae (UptimeRobot) | Consulta cada 5 minutos; de paso evita que se duerma | plan gratis |
| Tests automáticos | Agenda, permisos, ventas/crédito y arqueo de caja (unas 6 a 10 horas de trabajo) | sin costo |
| Pantalla de "salud del bot" | Mensajes fallidos, recordatorios no enviados, tokens por vencer, gasto de IA por cliente | sin costo |
| Simulador de conversaciones | Prueba del bot sin gastar crédito, con IA y WhatsApp simulados. Hacerlo cuando haya crédito y documentación de Meta | sin costo |
| Backups verificados | Confirmar la retención del plan de Supabase y probar una restauración | según el plan |
| Mensaje que se pierde si el servidor se reinicia | El agrupado de 15 segundos vive en memoria; requiere guardarlo en la base | sin costo |

## 3. Legal y comercial (no es código)

- Confirmar con el contador el rubro de software en el RUC de AS BIT.
- Términos del servicio (AS BIT ↔ negocio cliente).
- Acuerdo de tratamiento de datos (Ley 6534: el negocio es responsable, AS BIT encargado).
- Aviso de privacidad para el cliente final (pacientes).
- Facturación de la suscripción y medio de cobro (transferencia, Tigo Money, más adelante Bancard o dLocal).
- Revisar todo con un abogado antes del primer contrato.
- Definir los precios de los planes en guaraníes (Básico, Negocio, Full).
- Costo real por cliente: IA más mensajes de Meta, para saber el margen.

## 4. Validación con clientes (lo que más valor agrega)

- Elegir el cliente piloto (clínica o nutricionista) y cargar sus datos reales: servicios, precios, horarios, feriados.
- Acordar condiciones: gratis o muy barato por 30 a 60 días a cambio de feedback y testimonio.
- Correr el bot en un negocio real durante 30 días.
- Medir la métrica estrella: **tasa de ausencias antes y después**.
- Material de venta con esas métricas, para salir a buscar los clientes 2 a 5.
- Página de AS ADMIN dentro del sitio de AS BIT, con SEO local.

## 5. Mejoras chicas conocidas (código, sin urgencia)

- "Esta semana" y "Este mes" son ventanas móviles de 7 y 30 días, no calendario.
- Los sueldos y documentos de los empleados los puede leer todo el equipo (falta restringirlo en la base).
- La configuración del negocio se actualiza leyendo y escribiendo, no de forma atómica.
- El escaneo de código de barras con cámara se descartó; queda el lector USB.
- Marca propia por cliente: falta dominio propio (hoy hay nombre, color y logo).
- Módulos de agenda: los horarios que cruzan medianoche no funcionan en el motor de turnos (el saludo del bot sí los entiende).

## Orden sugerido cuando haya presupuesto

1. Cargar crédito en Anthropic y arrancar la verificación de Meta (en paralelo, porque Meta tarda).
2. Servidor pago, Sentry y UptimeRobot.
3. Simulador y tests automáticos.
4. Pruebas reales del bot con el número de prueba de Meta.
5. Cliente piloto durante 30 días, midiendo ausencias.
6. Legal, precios y facturación antes del primer cliente que pague.
