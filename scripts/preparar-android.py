"""Ajusta o projeto Android gerado pelo Capacitor: leitor de notificações, permissões e ícones."""
import pathlib, shutil

raiz = pathlib.Path(__file__).resolve().parent.parent
app = raiz / "android" / "app" / "src" / "main"
pacote = app / "java" / "br" / "com" / "tavares" / "financeiro"
pacote.mkdir(parents=True, exist_ok=True)
for arq in (raiz / "native").glob("*.java"):
    shutil.copy(arq, pacote / arq.name)

manifesto = app / "AndroidManifest.xml"
txt = manifesto.read_text(encoding="utf-8")
perms = ["android.permission.POST_NOTIFICATIONS", "android.permission.SCHEDULE_EXACT_ALARM", "android.permission.RECEIVE_BOOT_COMPLETED", "android.permission.REQUEST_INSTALL_PACKAGES", "android.permission.INTERNET"]
extra = "".join(f'    <uses-permission android:name="{p}" />\n' for p in perms if p not in txt)
txt = txt.replace("</manifest>", extra + "</manifest>")
servico = """
        <service
            android:name=".LeitorBancos"
            android:label="Controle Financeiro"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
            android:exported="true">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService" />
            </intent-filter>
        </service>
"""
if "com.google.mlkit.vision.DEPENDENCIES" not in txt:
    txt = txt.replace("</application>", '        <meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="ocr" />\n    </application>')
if "LeitorBancos" not in txt:
    txt = txt.replace("</application>", servico + "    </application>")
# aparece no botão Compartilhar (foto, print, PDF, texto)
compartilhar = """
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="text/plain" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
                <data android:mimeType="application/pdf" />
            </intent-filter>
"""
if "android.intent.action.SEND" not in txt:
    i = txt.index('android:name=".MainActivity"')
    j = txt.index("</intent-filter>", i) + len("</intent-filter>")
    txt = txt[:j] + compartilhar.rstrip() + txt[j:]
manifesto.write_text(txt, encoding="utf-8")

res = app / "res"
for pasta in (raiz / "android-res").iterdir():
    destino = res / pasta.name
    destino.mkdir(parents=True, exist_ok=True)
    for arq in pasta.iterdir():
        shutil.copy(arq, destino / arq.name)

# número da versão: cresce a cada APK, pra o Android aceitar atualizar por cima
import os, re
n = os.environ.get("VERSAO", "1")
gradle = raiz / "android" / "app" / "build.gradle"
g = gradle.read_text(encoding="utf-8")
g = re.sub(r"versionCode \d+", f"versionCode {n}", g)
g = re.sub(r'versionName "[^"]*"', f'versionName "1.0.{n}"', g)
# leitura de texto de foto/PDF no próprio celular (grátis, sem internet)
# versão que usa o leitor do Google Play (o app fica bem menor)
if "mlkit-text-recognition" not in g:
    g = re.sub(r"dependencies\s*\{", "dependencies {\n    implementation 'com.google.android.gms:play-services-mlkit-text-recognition:19.0.1'", g, count=1)
gradle.write_text(g, encoding="utf-8")

print("Android preparado, versão 1.0." + n)
