# WhatsApp Baileys Server

Servidor Node.js con Baileys para integración real de WhatsApp con tu aplicación Supabase.

## 🚀 Configuración Local

1. **Instalar dependencias:**
```bash
npm install
```

2. **Configurar variables de entorno:**
```bash
cp .env.example .env
# Editar .env con tus credenciales de Supabase
```

3. **Ejecutar en desarrollo:**
```bash
npm run dev
```

4. **Ejecutar en producción:**
```bash
npm start
```

## 📁 Estructura del proyecto

```
whatsapp-server/
├── package.json       # Dependencias del proyecto
├── server.js          # Servidor Express principal
├── whatsapp.js        # Lógica de Baileys y WhatsApp
├── handlers.js        # Manejadores de rutas HTTP
├── .env.example       # Ejemplo de variables de entorno
├── sessions/          # Sesiones de WhatsApp (se crea automáticamente)
└── README.md          # Esta documentación
```

## 🔌 Endpoints disponibles

- `GET /health` - Health check del servidor
- `POST /auth/start` - Iniciar autenticación de WhatsApp
- `POST /auth/disconnect` - Desconectar WhatsApp
- `POST /send-message` - Enviar mensaje de WhatsApp
- `GET /status/:merchantId` - Estado de conexión

## 🌐 Despliegue en Railway

1. Conectar tu repositorio a Railway
2. Configurar las variables de entorno
3. Railway detectará automáticamente que es un proyecto Node.js
4. ¡Listo!

## 🔧 Variables de entorno requeridas

- `SUPABASE_URL`: URL de tu proyecto Supabase
- `SUPABASE_ANON_KEY`: Clave anónima de Supabase
- `PORT`: Puerto del servidor (Railway lo configura automáticamente)
