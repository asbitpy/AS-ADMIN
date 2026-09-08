# AS ADMIN — Árbol de conversación del bot (WhatsApp) — v2

Piloto: clínica / nutricionista. Adaptable a otros rubros (barbería, salón) cambiando solo la configuración por negocio.

---

## Qué cambia en la v2 (resumen)

1. **Arquitectura híbrida (reglas + IA):** Claude no redacta todo — clasifica la intención y extrae datos; las respuestas críticas (confirmaciones, precios) son plantillas fijas. Menos costo, menos errores, más control.
2. **Botones interactivos nativos de WhatsApp** en vez de pedir que escriban números — menos ambigüedad, menos llamadas a la IA.
3. **Restricción técnica crítica documentada:** la ventana de 24hs de Meta y las plantillas aprobadas (sin esto, los recordatorios no salen).
4. **Nuevos flujos:** lista de espera, turnos recurrentes, agendar para otra persona, doble recordatorio, post-consulta con pedido de reseña de Google, reactivación de clientes inactivos.
5. **Casos especiales ampliados:** audios, fotos, grupos, reclamos, feriados, multi-profesional, llegadas tarde, no-shows.
6. **Métricas de ROI** para el panel del dueño — el argumento de venta del producto.

---

## 1. Arquitectura híbrida: dónde entra la IA y dónde no

La regla de oro para eficiencia y confiabilidad:

| Tarea | Quién la hace | Por qué |
|---|---|---|
| Interpretar qué quiere el cliente (texto libre, jopara, errores de tipeo) | **Claude** | Es lo que la IA hace mejor |
| Extraer datos del mensaje ("el jueves a la tarde", "para mi mamá") | **Claude** | Interpretación flexible |
| Responder precios, ubicación, horarios | **Plantilla fija** | Cero riesgo de inventar un precio; cero costo de tokens |
| Confirmar un turno | **Plantilla fija** | Un turno mal confirmado destruye la confianza |
| Detectar contenido médico o reclamo | **Claude** (clasificador) | Deriva a humano de inmediato |
| Redactar el saludo/menú | **Plantilla fija** | Consistencia total |

En la práctica: el mensaje del cliente pasa por Claude una sola vez para clasificar intención + extraer datos, y el sistema responde con la plantilla que corresponde. Claude solo redacta libremente en casos ambiguos o conversacionales. Esto baja el costo por conversación drásticamente y elimina el riesgo de que el bot "invente" precios u horarios.

---

## 2. Restricción técnica crítica: la ventana de 24hs de Meta

- Dentro de las **24hs posteriores al último mensaje del cliente**, el negocio puede responder libremente (conversación de servicio).
- **Fuera de esa ventana** (ej. el recordatorio de turno del día siguiente), solo se pueden enviar **plantillas pre-aprobadas por Meta** (categoría "utility").
- Consecuencia práctica: **los recordatorios, el pedido de reseña y la reactivación de inactivos deben registrarse como plantillas en Meta Business Manager antes del lanzamiento.** Aprobarlas toma tiempo — hacerlo en la semana 1, no al final.

---

## 3. Reglas base (ampliadas)

- Si el bot no entiende **dos veces seguidas** → deriva a humano.
- Siempre hay salida visible a "hablar con alguien".
- Contenido médico (síntomas, dolor, estudios) → deriva **inmediato** a humano. El bot nunca opina de salud.
- Tono de reclamo o enojo detectado → deriva inmediato a humano **con prioridad alta** en el panel.
- Motivo de consulta siempre en términos generales: "primera vez", "control", "seguimiento".
- Revalidar disponibilidad **antes** de confirmar (evita doble reserva).
- **El bot no responde en grupos de WhatsApp** — solo chats individuales.
- Mensajes duplicados (doble envío) → se procesan una sola vez.

---

## 4. Menú principal (ahora con botones nativos)

En vez de pedir que tipeen "1, 2, 3, 4", se usan los **mensajes interactivos de WhatsApp** (botones de respuesta rápida y listas). Menos errores, más velocidad, y el cliente igual puede escribir libre si prefiere.

```
¡Hola! 👋 Soy el asistente de [Nombre del negocio].
¿En qué te puedo ayudar?

[Botón: 📅 Agendar turno]
[Botón: 💰 Precios y servicios]
[Botón: 📍 Ubicación y horarios]
(+ opción en lista: 🙋 Hablar con alguien)
```

---

## 5. Rama: Agendar turno (mejorada)

**Paso 1 — Tipo de consulta** → lista interactiva con los servicios configurados.

**Paso 2 — ¿Para quién es el turno?** *(nuevo)*
```
¿El turno es para vos o para otra persona?
[Botón: Para mí] [Botón: Para otra persona]
```
Si es para otra persona: pide nombre de quien asiste y guarda al que escribe como contacto. (Muy común: madres agendando para hijos, parejas entre sí.)

**Paso 3 — Franjas disponibles** → lista interactiva con las 3-4 franjas más próximas.
- *Mejora de eficiencia (v2): ordenar las franjas ofrecidas para compactar la agenda* — ofrecer primero los huecos pegados a turnos ya existentes, minimizando "horas muertas" entre consultas.
- **Si no hay franjas que le sirvan** → flujo de **lista de espera** *(nuevo)*:
```
Por ahora no tengo lugar en ese horario 😔
¿Querés que te anote en lista de espera y te avise si se libera un lugar?
[Botón: Sí, anotame] [Botón: No, gracias]
```
Cuando alguien cancela, el sistema ofrece automáticamente esa franja al primero de la lista.

**Paso 4 — Confirmación** → plantilla fija con día, hora, dirección, y aviso del recordatorio.

**Paso 5 — Registro interno** → guarda turno + servicio + precio (alimenta el módulo financiero sin carga manual).

---

## 6. Recordatorios (mejorados: ahora son dos)

**Recordatorio 1 — 24hs antes** (plantilla aprobada, con botones):
```
Hola [Nombre] 👋 Te recordamos tu turno mañana [fecha] a las [hora].
[Botón: ✅ Confirmo] [Botón: 🔁 Reprogramar] [Botón: ❌ Cancelar]
```

**Recordatorio 2 — 2-3hs antes, SOLO si no respondió el primero** *(nuevo)*:
```
Hola [Nombre], tu turno es hoy a las [hora]. ¿Contamos con vos?
[Botón: ✅ Sí] [Botón: ❌ No puedo]
```
Este segundo toque es el que más reduce ausencias — la mayoría de los no-shows son gente que respondió nada, no gente que canceló.

**Si cancela** → libera la franja → dispara la oferta automática a la lista de espera.

---

## 7. Flujos nuevos post-consulta

**7a. Agradecimiento + reseña de Google** *(nuevo — sinergia directa con AS BIT)*
Unas horas después del turno completado:
```
¡Gracias por venir hoy, [Nombre]! 🙌
Si quedaste conforme, nos ayudaría muchísimo una reseña:
[link directo a reseña de Google]
```
Cada reseña mejora el SEO local del negocio — y el SEO local es literalmente el otro servicio que vende AS BIT. Un mismo cliente, dos productos que se refuerzan.

**7b. Turno recurrente** *(nuevo — clave para nutricionistas)*
Si el servicio es de seguimiento (ej. control nutricional cada 15 días), al completarse el turno:
```
[Profesional] suele indicar control en [X] días.
¿Querés dejar agendado el próximo ya mismo?
[Botón: 📅 Sí, agendar] [Botón: Después veo]
```
Esto convierte un turno en una serie de turnos — más ingresos para el negocio sin esfuerzo, y es medible en el panel.

**7c. Reactivación de inactivos** *(nuevo — usar con moderación)*
Cliente sin turnos hace más de X días (configurable, ej. 90):
```
Hola [Nombre] 👋 Hace un tiempo que no nos vemos por [negocio].
¿Querés agendar un control?
```
Requiere plantilla aprobada. Regla: **máximo un mensaje de reactivación por cliente por período**, y si no responde, no se insiste — el bot nunca debe sentirse spam.

---

## 8. Casos especiales (tabla ampliada)

| Situación | Cómo se maneja |
|---|---|
| **Audios** (muy común en Paraguay) | v1: responder "¿Me lo podés escribir? Así te ayudo más rápido 🙏". v2 recomendada: transcribir el audio con un servicio de speech-to-text y procesarlo normal — gran diferenciador local |
| **Fotos/documentos** (ej. estudios médicos) | No se procesan. Deriva a humano: "Le paso tu archivo directo a [profesional] 👍" |
| Mensaje en grupo de WhatsApp | El bot no responde en grupos, nunca |
| Cliente avisa que llega tarde | Registra la nota en el turno y notifica al dueño; no reprograma salvo que lo pida |
| **No-show** (no vino, no avisó) | Se marca en el sistema. Al día siguiente: "Te esperamos ayer y no pudiste venir 😔 ¿Querés reagendar?" — una sola vez, sin insistir |
| Reclamo / tono de enojo | Deriva inmediato a humano con **prioridad alta**; el bot solo responde: "Entiendo, le paso tu mensaje ahora mismo a [nombre] para que te contacte directo" |
| Pregunta por formas de pago / seña | Plantilla fija con los medios que acepta el negocio (efectivo, transferencia, tarjeta, QR) |
| Feriado o vacaciones del negocio | Calendario de excepciones en la config: el bot no ofrece franjas en esos días y avisa desde cuándo hay lugar |
| Clínica con varios profesionales | La config soporta múltiples agendas: el cliente elige profesional (o "el primero disponible") antes de ver franjas |
| Cliente frecuente | Reconocimiento: "¡Hola de nuevo, [Nombre]!" + salta pasos que ya conoce (no vuelve a pedir su nombre) |
| Varios turnos en un mensaje ("para mí y mi hermana") | El bot agenda de a uno: completa el primero y ofrece arrancar el segundo |
| Franja tomada mientras decidía | Revalida antes de confirmar; si se ocupó, ofrece nuevas opciones con disculpa breve |
| Guaraní / jopara | Responde con naturalidad en el mismo registro |
| Spam / número equivocado | Respuesta breve, no se registra como lead |
| Mensaje fuera de horario comercial | Responde y agenda igual (la ventaja del bot); puede aclarar que el local está cerrado |

---

## 9. Panel del dueño: métricas que venden el producto

Estas métricas son el argumento de ROI cuando salgas a vender AS ADMIN al siguiente cliente:

- **Tasa de ausencias** antes vs. después del bot (la métrica estrella)
- Turnos agendados por el bot vs. agendados a mano
- % de turnos confirmados por recordatorio (1er toque vs. 2do toque)
- Turnos recuperados por lista de espera
- Turnos generados por recordatorio de recurrencia
- Reseñas de Google generadas desde el bot
- Horario pico de mensajes (para que el dueño sepa cuándo lo estaba perdiendo antes)
- Conversaciones derivadas a humano (y por qué motivo)

Regla del panel: la vista principal es "**HOY**" — turnos del día con estado (✅ confirmado / ⏳ sin responder / ❌ cancelado) — todo lo demás está a un tap de distancia, no en la cara.

---

## 10. Nota técnica actualizada

**Config por negocio (sin tocar código):**
- Datos del negocio: nombre, dirección, mapa, horarios, feriados/vacaciones
- Servicios con precio, duración y si son recurrentes (y cada cuántos días)
- Profesionales y sus agendas (si hay más de uno)
- Medios de pago aceptados
- Tono del bot (formal/cercano) y reglas de lo que NO responde
- Tiempos: buffer entre turnos, cuándo dispara cada recordatorio, umbral de inactividad

**Sistema:**
- Clasificador de intención con Claude (una llamada por mensaje entrante, salida estructurada: intención + datos extraídos)
- Plantillas de respuesta fijas mapeadas a cada intención
- Función de disponibilidad (con lógica de compactar agenda)
- Motor de recordatorios programados (24hs + mismo día) usando plantillas aprobadas de Meta
- Cola de lista de espera por franja liberada
- Bandera "derivado a humano" con prioridad (normal / alta) visible en el panel
- Registro de eventos por turno (agendado, confirmado, reprogramado, cancelado, no-show, completado) — esta trazabilidad es la base del módulo financiero y de las métricas

---

## Próximos pasos
1. Validar este árbol con el cliente piloto y cargar sus datos reales
2. Registrar las plantillas de Meta (recordatorios, reseña, reactivación) — **semana 1, porque la aprobación demora**
3. Escribir el system prompt del clasificador de intenciones (intención + extracción de datos, salida en JSON)
4. Simular 10-15 conversaciones típicas + los casos especiales de la tabla antes de mostrar nada al cliente
