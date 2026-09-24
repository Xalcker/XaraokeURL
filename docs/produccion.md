# 🚀 Despliegue en Producción

Para desplegar en producción:

1. Configura `NODE_ENV=production` en tu archivo `.env`
2. Asegúrate de usar HTTPS (el servidor confía en el primer proxy)
3. Configura las rutas de datos persistentes:
   - Base de datos: `/data/karaoke.db`
   - Sesiones: `/data/sessions`
   - Descargas de YouTube: `/data/downloads` (archivos) y `/data/downloads.db` (registro; necesita permiso de escritura)
   - Calificaciones del karaoke: `/data/ratings.db` (necesita permiso de escritura; si no se puede abrir, el servidor arranca igual pero no pide calificar)
4. Actualiza las URLs de callback de Google OAuth con tu dominio de producción
5. Si vas a usar la búsqueda/descarga de YouTube, instala `yt-dlp` y `ffmpeg` en el host de producción (no se instalan solos con `npm install`)
6. El servidor cierra ordenadamente con `SIGTERM` o `SIGINT`: deja de aceptar conexiones, cierra las que haya y cierra las bases de datos antes de salir, para no cortar una escritura a medias en un despliegue. Si algo se cuelga, se sale igual a los 10 segundos.
