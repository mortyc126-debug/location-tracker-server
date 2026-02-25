# OkHttp + WebSocket
-dontwarn okhttp3.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# JSON
-keep class org.json.** { *; }

# Google Play Services Location
-keep class com.google.android.gms.location.** { *; }

# WorkManager
-keep class androidx.work.** { *; }

# osmdroid
-keep class org.osmdroid.** { *; }

# Android компоненты — запускаются по имени из манифеста, нельзя переименовывать
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.app.Service
-keep public class * extends android.app.job.JobService

# BuildConfig
-keep class com.example.locationtracker.BuildConfig { *; }

# Скрываем пакетную структуру
-repackageclasses "a.b.c"
-allowaccessmodification
