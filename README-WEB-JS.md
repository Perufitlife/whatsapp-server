# WhatsApp-Web.js Server

Nueva implementación del servidor WhatsApp usando whatsapp-web.js para mejorar la estabilidad y detección de números de teléfono reales.

## Características

- Integración con WhatsApp Business usando whatsapp-web.js
- Autenticación por código QR
- Manejo de mensajes en tiempo real
- Persistencia de sesiones mejorada
- Soporte multi-merchant
- Detección de números de teléfono reales
- Webhooks a Supabase mejorados

## Variables de Entorno

Crea un archivo `.env` con las siguientes variables:

```env
# Configuración del Servidor
PORT=3001
NODE_ENV=production

# Configuración de Supabase (Requerido)
SUPABASE_URL=https://jbwbiomnsbpmcnjgzrqp.supabase.co
SUPABASE_ANON_KEY=tu-clave-anon-aqui
SUPABASE_SERVICE_ROLE_KEY=tu-clave-service-role-aqui

# Opcional: Configuración de Railway
RAILWAY_STATIC_URL=https://tu-app.up.railway.app
```

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

## Producción

```bash
npm start
```

## Endpoints de la API

### Autenticación
- `POST /auth/start` - Iniciar autenticación de WhatsApp (genera código QR)
- `POST /auth/disconnect` - Desconectar sesión de WhatsApp

### Estado
- `GET /status/:merchantId` - Obtener estado de conexión y código QR

### Mensajería
- `POST /send-message` - Enviar mensaje de WhatsApp

### Verificación de Salud
- `GET /health` - Estado de salud del servidor
- `GET /test` - Endpoint de prueba simple

## Despliegue en Railway

1. Conecta tu repositorio de GitHub a Railway
2. Configura las variables de entorno en el dashboard de Railway:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Despliega

## Almacenamiento de Sesiones

Las sesiones se almacenan en el directorio `wa-sessions/`. Cada merchant tiene su propia carpeta de sesión para mantener conexiones separadas de WhatsApp.

## Diferencias con Baileys

### Ventajas de WhatsApp-Web.js:
- Mayor estabilidad de conexión
- Mejor manejo de sesiones
- Detección precisa de números de teléfono
- Menos problemas con QR codes
- Mejor soporte para múltiples dispositivos

### Características Mejoradas:
- Autenticación más robusta
- Manejo de errores mejorado
- Logs más detallados
- Mejor integración con Puppeteer

## Manejo de Errores

El servidor incluye manejo integral de errores y logging. Revisa los logs de Railway para información de depuración.

## Migración desde Baileys

Esta implementación es completamente compatible con la API existente. Solo necesitas:

1. Actualizar las variables de entorno
2. Desplegar el nuevo servidor
3. Actualizar las URLs en las Edge Functions

## Dependencias

- `whatsapp-web.js` - WhatsApp Web API
- `puppeteer` - Controlador del navegador
- `express` - Framework web
- `qrcode` - Generación de códigos QR
- `axios` - Cliente HTTP
- `cors` - Manejo de CORS

## Troubleshooting

### Error: Puppeteer no funciona
- Asegúrate de que todas las dependencias estén instaladas
- Verifica que el entorno soporte Chromium

### Error: QR no se genera
- Revisa los logs del servidor
- Verifica la conexión a internet
- Limpia las sesiones existentes

### Error: Mensajes no se envían
- Verifica que WhatsApp esté conectado
- Revisa el formato del número de teléfono
- Verifica que el merchant tenga una sesión activa
