# Credential Manager carga por reflexión su implementación de Google Play Services.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
  *;
}

# ML Kit (el lector de QR) crea sus componentes por reflexión con el constructor sin argumentos;
# sin esto, R8 los quita y la app se cierra al tocar "Escanear código QR" (solo en release).
-keep class * implements com.google.firebase.components.ComponentRegistrar {
  <init>();
}
-keep class com.google.mlkit.**.*Registrar {
  <init>();
}
