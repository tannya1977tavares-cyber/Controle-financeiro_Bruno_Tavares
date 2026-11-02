package br.com.tavares.financeiro;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import android.os.Build;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.util.HashSet;
import java.util.Set;

/** Ponte entre o app (JavaScript) e o leitor de notificações dos bancos. */
@CapacitorPlugin(name = "AvisosBancos")
public class AvisosBancosPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("liberado", NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName()));
        call.resolve(r);
    }

    @PluginMethod
    public void abrirAjustes(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void abrirInfoDoApp(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void pegar(PluginCall call) {
        try {
            JSObject r = new JSObject();
            r.put("itens", new JSArray(Fila.ler(getContext()).toString()));
            call.resolve(r);
        } catch (Exception e) { call.reject("Não deu pra ler os avisos"); }
    }

    @PluginMethod
    public void apagar(PluginCall call) {
        try {
            JSONArray a = call.getArray("chaves", new JSArray());
            Set<String> s = new HashSet<>();
            for (int i = 0; i < a.length(); i++) s.add(a.getString(i));
            Fila.apagar(getContext(), s);
            call.resolve();
        } catch (Exception e) { call.reject("Não deu pra apagar"); }
    }

    /** Baixa o APK novo e abre o instalador do Android (atualiza por cima, sem desinstalar). */
    @PluginMethod
    public void atualizar(PluginCall call) {
        final String endereco = call.getString("url");
        if (endereco == null) { call.reject("Sem endereço"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.reject("PERMITIR");
            return;
        }
        new Thread(() -> {
            try {
                File arq = new File(getContext().getCacheDir(), "atualizacao.apk");
                URL url = new URL(endereco);
                HttpURLConnection con = null;
                for (int r = 0; r < 5; r++) {
                    con = (HttpURLConnection) url.openConnection();
                    con.setInstanceFollowRedirects(false);
                    con.setConnectTimeout(20000); con.setReadTimeout(60000);
                    int cod = con.getResponseCode();
                    if (cod >= 300 && cod < 400) { url = new URL(url, con.getHeaderField("Location")); con.disconnect(); continue; }
                    break;
                }
                if (con.getResponseCode() != 200) throw new Exception("HTTP " + con.getResponseCode());
                try (InputStream in = con.getInputStream(); FileOutputStream out = new FileOutputStream(arq)) {
                    byte[] buf = new byte[16384]; int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", arq);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject("Não deu pra baixar a atualização");
            }
        }).start();
    }
    /** Salva um arquivo (base64) e abre no app certo, ex.: planilha no Excel. */
    @PluginMethod
    public void abrirArquivo(PluginCall call) {
        String nome = call.getString("nome", "arquivo");
        String dados = call.getString("base64", "");
        String tipo = call.getString("tipo", "application/octet-stream");
        try {
            File pasta = new File(getContext().getCacheDir(), "planilhas");
            pasta.mkdirs();
            File arq = new File(pasta, nome);
            try (FileOutputStream out = new FileOutputStream(arq)) {
                out.write(android.util.Base64.decode(dados, android.util.Base64.DEFAULT));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", arq);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, tipo);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(i);
            } catch (android.content.ActivityNotFoundException e) {
                Intent s = new Intent(Intent.ACTION_SEND);
                s.setType(tipo);
                s.putExtra(Intent.EXTRA_STREAM, uri);
                s.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent esc = Intent.createChooser(s, "Abrir planilha com");
                esc.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(esc);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Não deu pra abrir a planilha");
        }
    }
}
