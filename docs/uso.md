# 💡 Cómo Usar

1.  Abre la aplicación en un navegador en tu computadora o TV (el **Host**).
2.  Haz clic en "Comenzar" para crear una nueva sala. Se generará un código de sala de 4 letras.
3.  Escanea el código QR con la cámara de tu teléfono para abrir el **Control Remoto**. El QR ya lleva el código de sala (`/remote.html?sala=ABCD`), así que no hay que escribirlo.
4.  Inicia sesión con tu cuenta de Google (debe ser del dominio autorizado configurado en el código). Al volver de Google, el teléfono entra directo a la sala. Sin login de Google (modo desarrollo), el código aparece ya escrito y solo falta poner tu nombre y tocar "Unirse".
5.  Si no puedes escanear el QR, entra a la dirección escrita bajo él (en la [vista minimalista](kiosko.md#vista-minimalista-uiminimal), la de la pantalla de espera) e introduce el código de sala de 4 letras.
6.  En la pestaña **Buscar**, usa el explorador alfabético o el buscador de texto para encontrar tu canción favorita y añadirla a la lista (si no aparece, puedes buscarla en YouTube — ver [Búsqueda y descarga desde YouTube](youtube.md)).
7.  Un aviso confirma que se añadió, y la lista se actualiza en la pantalla principal y en todos los remotos conectados; en la pestaña **Mi lista** ves tu posición, puedes quitar tus canciones y, si tienes varias en espera, cambiarles el orden con las flechas.
8.  Recibirás una notificación (vibración, sonido y un aviso visual) 10 segundos antes de que empiece tu canción.
9.  ¡Espera tu turno y canta! Al terminar, califica con un pulgar qué tal estuvo el karaoke.

## Si el host cierra el reproductor sin querer

Si el host se desconecta (por ejemplo, alguien cierra la pestaña de la pantalla principal por error), todos los remotos muestran un aviso de que la reproducción está en pausa hasta que vuelva.

* **La sala no se borra al momento.** Si se queda sin nadie conectado, se conserva con su lista durante un tiempo de gracia: `ROOM_GRACE_MINUTES` (10 minutos por defecto; con `0` se borra en cuanto se queda vacía). Mientras haya algún remoto conectado, la sala sigue existiendo.
* **El host la recupera.** La pantalla principal guarda en el navegador el código de la sala y su token de host. Al volver a abrirla, la pantalla de inicio ofrece **"Recuperar la sala XXXX"** (con cuántas canciones hay en la lista) y, aparte, **"Crear una sala nueva"**. Recuperarla reconecta como host y retoma la lista tal como estaba; la canción que sonaba empieza desde el principio.
* **Los remotos se enteran.** Los que sigan abiertos ven un aviso de que el host regresó y la sala está disponible de nuevo, y los controles de reproducción se reactivan.
* **Si el tiempo se agotó** (o el servidor se reinició), la sala ya no existe: la pantalla de inicio solo ofrece crear una nueva. Si el host tenía la pantalla abierta cuando pasó, avisa y vuelve al inicio.
* **Una sola pantalla de host por sala.** Si se recupera la sala mientras la pantalla anterior seguía abierta, el servidor desconecta a la anterior para que no suenen dos karaokes a la vez.

## 📺 Modo TV (pantalla principal)

La pantalla principal está pensada para verse de lejos:

* **Se adapta al tamaño de la pantalla:** el tamaño de la letra y de las tarjetas crece con el ancho de la ventana (de 16 px en una ventana pequeña a unos 22 px en una TV de 1920 px, con tope de 26 px). "Ahora suena" y "A continuación" muestran en grande el artista, la canción y **quién canta**, en color.
* **El QR va arriba a la derecha:** en la vista clásica, el panel del control remoto está arriba en la barra derecha y el logo abajo; en la minimalista y en el reproductor nativo, el QR flota arriba a la derecha. La letra de los karaokes suele ir en la mitad de abajo del video, y así no la tapa.
* **Pantalla de espera:** con la lista vacía, el video negro deja su lugar a un código QR grande, el código de sala y la dirección escrita por si no se puede escanear. En cuanto alguien añade una canción, vuelve el video.
* **Cuenta regresiva antes de cada canción:** como en el cine, un círculo con una aguja que da la vuelta cada segundo y el número grande, con **quién canta** y la canción debajo, para que esa persona tome el micrófono. Dura `SONG_COUNTDOWN_SECONDS` (5 segundos por defecto, hasta 30; con `0` no hay cuenta). Mientras corre, el botón de pausa de quien canta la detiene, y saltar la cancela. No se repite si la canción se cae por un error de red y se retoma donde iba. El reproductor nativo muestra la misma cuenta.
* **Pantalla completa:** botón discreto abajo a la izquierda, tecla `F` o doble clic sobre el video. Entra toda la página (no solo el video), así que la lista y el QR siguen a la vista; `Esc` sale. Tras 3 segundos sin mover el ratón ni pulsar teclas, se ocultan el cursor y el botón.
* **Pantalla siempre encendida:** al comenzar la sesión se pide al navegador que no apague la pantalla (Screen Wake Lock API), y se vuelve a pedir si la pestaña se oculta y regresa. **El navegador solo lo permite en `localhost` o con HTTPS**: si abres la pantalla por la IP de la red con HTTP (`http://192.168.0.72:8081`), no está disponible y la pantalla puede apagarse por inactividad del sistema (mientras suena un video, los navegadores suelen mantenerla encendida). Por eso conviene abrirla como `localhost`.

## ⭐ Calificar el karaoke

Al terminar una canción, a **quien la cantó** (y solo a esa persona) le aparece abajo una tarjeta: *"¿Cómo estuvo el karaoke de …?"*, con **Bien** (pulgar arriba), **Mal** (pulgar abajo) y **Ahora no**. Lo que se califica es el video y la música, no el desempeño de quien cantó; la tarjeta lo dice.

* **Solo cuando la canción termina sola.** Si alguien la salta, no se pide calificar.
* **No estorba:** no es una ventana que bloquee la pantalla y se puede ignorar. Si se termina otra canción tuya antes de responder, se muestran una tras otra. Si pierdes la conexión o recargas la página, se te vuelve a pedir mientras la sala siga abierta.
* **Una calificación por persona y canción.** Las de YouTube se identifican por el video (no por el archivo, que se borra con el tiempo), así que una calificación sobrevive aunque la descarga se borre; las de la biblioteca, por su nombre de archivo. Si la misma persona vuelve a calificarla más adelante, la nueva reemplaza a la anterior.
* **Se guardan en `ratings.db`** (`RATINGS_DB_PATH`; `./ratings.db` en desarrollo, `/data/ratings.db` en producción, se crea sola), aparte de `downloads.db` porque las descargas se borran solas y las calificaciones deben quedar. Cada fila trae la clave de la canción (`yt:<id del video>` o `lib:<archivo>`), quién calificó, el valor (1 o -1), el título y la fecha. Si esa base no se puede abrir, el servidor arranca igual, deja un aviso en los logs y simplemente no pide calificar.
* **Se muestran sumadas de todas las salas.** Junto a cada canción (en los resultados de búsqueda y en la lista) aparece cuántos pulgares arriba y abajo lleva en total. Las de YouTube se muestran mientras el video siga descargado. Por ahora no influyen en el orden de los resultados.
