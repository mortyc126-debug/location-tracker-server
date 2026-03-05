# --- Общие настройки ---
-optimizationpasses 5
-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-verbose

# --- Сохранение метаданных ---
-keepattributes Signature
-keepattributes Exceptions
-keepattributes InnerClasses
-keepattributes SourceFile,LineNumberTable

# --- OkHttp + WebSocket ---
-dontwarn okhttp3.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# --- JSON (Gson) ---
-keep class org.json.** { *; }
-keep class com.google.gson.** { *; }

# --- Google Play Services Location ---
-keep class com.google.android.gms.location.** { *; }
-keep class com.google.android.gms.tasks.** { *; }

# --- WorkManager ---
-keep class androidx.work.** { *; }

# --- Android компоненты ---
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.app.job.JobService

# --- Custom Classes & Reflection ---
-keep class com.example.cerberus2.** { *; }

# --- Обработка ошибок ---
-dontwarn java.io.**
-dontwarn android.graphics.**

# --- Оптимизация ProGuard (уменьшение размера APK) ---
-keepclassmembers class * {
    @com.example.cerberus2.annotations.** <fields>;
}

-allowaccessmodification

# --- Скрытие пакетной структуры ---
-repackageclasses "a.b.c"

# --- Примеры правил для конкретных классов ---
-keep class com.example.cerberus2.DeviceIdManager { *; }
-keep class com.example.cerberus2.AppIntegrityChecker { *; }
-keep class com.example.cerberus2.DataProtection { *; }
