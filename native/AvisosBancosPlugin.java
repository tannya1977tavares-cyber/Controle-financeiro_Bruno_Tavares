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

import android.content.ContentResolver;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.util.ArrayList;
import java.util.List;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

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
    /* ---------- comprovantes vindos do botão Compartilhar ---------- */
    private final List<JSObject> compartilhados = new ArrayList<>();
    private int lendo = 0;

    @Override
    public void load() {
        Intent i = getActivity().getIntent();
        if (i != null) receber(i);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        receber(intent);
    }

    private void receber(Intent intent) {
        String acao = intent.getAction();
        if (!Intent.ACTION_SEND.equals(acao) && !Intent.ACTION_SEND_MULTIPLE.equals(acao)) return;
        final List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(acao)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else {
            ArrayList<Uri> l = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (l != null) uris.addAll(l);
        }
        final String textoSolto = intent.getStringExtra(Intent.EXTRA_TEXT);
        getActivity().setIntent(new Intent());
        // copia os arquivos já (a permissão de leitura vale só agora)
        final List<File> arquivos = new ArrayList<>();
        final List<String> nomes = new ArrayList<>(), tipos = new ArrayList<>();
        ContentResolver cr = getContext().getContentResolver();
        File pasta = new File(getContext().getCacheDir(), "comprovantes");
        pasta.mkdirs();
        for (Uri u : uris) {
            try {
                String tipo = cr.getType(u), nome = "comprovante";
                try (Cursor c = cr.query(u, null, null, null, null)) {
                    if (c != null && c.moveToFirst()) { int k = c.getColumnIndex(OpenableColumns.DISPLAY_NAME); if (k >= 0) nome = c.getString(k); }
                } catch (Exception ignorado) {}
                if (tipo == null) tipo = nome.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/*";
                File f = new File(pasta, System.nanoTime() + (tipo.contains("pdf") ? ".pdf" : ".img"));
                try (InputStream in = cr.openInputStream(u); FileOutputStream out = new FileOutputStream(f)) {
                    byte[] buf = new byte[16384]; int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                arquivos.add(f); nomes.add(nome); tipos.add(tipo);
            } catch (Exception e) {
                JSObject r = new JSObject(); r.put("nome", "arquivo"); r.put("erro", "Não consegui abrir o arquivo"); guardar(r);
            }
        }
        if (arquivos.isEmpty() && (textoSolto == null || textoSolto.trim().isEmpty())) return;
        synchronized (this) { lendo++; }
        notifyListeners("compartilhado", new JSObject().put("lendo", true), true);
        new Thread(() -> {
            if (textoSolto != null && !textoSolto.trim().isEmpty()) {
                JSObject r = new JSObject(); r.put("nome", "texto"); r.put("tipo", "text/plain"); r.put("texto", textoSolto); guardar(r);
            }
            TextRecognizer leitor = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            for (int k = 0; k < arquivos.size(); k++) {
                JSObject r = new JSObject(); r.put("nome", nomes.get(k)); r.put("tipo", tipos.get(k));
                try { r.put("texto", lerArquivo(leitor, arquivos.get(k), tipos.get(k))); }
                catch (Exception e) { r.put("erro", "Não consegui ler esse arquivo"); }
                arquivos.get(k).delete();
                guardar(r);
            }
            leitor.close();
            synchronized (this) { lendo--; }
            notifyListeners("compartilhado", new JSObject().put("lendo", false), true);
        }).start();
    }

    private synchronized void guardar(JSObject r) { compartilhados.add(r); }

    private String lerArquivo(TextRecognizer leitor, File f, String tipo) throws Exception {
        StringBuilder sb = new StringBuilder();
        if (tipo.contains("pdf")) {
            try (ParcelFileDescriptor pfd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY); PdfRenderer pdf = new PdfRenderer(pfd)) {
                for (int p = 0; p < Math.min(3, pdf.getPageCount()); p++) {
                    try (PdfRenderer.Page pg = pdf.openPage(p)) {
                        float escala = Math.min(3f, 2000f / Math.max(pg.getWidth(), pg.getHeight()) * 1.0f);
                        escala = Math.max(escala, 1.5f);
                        Bitmap b = Bitmap.createBitmap((int) (pg.getWidth() * escala), (int) (pg.getHeight() * escala), Bitmap.Config.ARGB_8888);
                        new Canvas(b).drawColor(Color.WHITE);
                        pg.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                        sb.append(Tasks.await(leitor.process(InputImage.fromBitmap(b, 0))).getText()).append("\n");
                        b.recycle();
                    }
                }
            }
        } else {
            BitmapFactory.Options o = new BitmapFactory.Options(); o.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(f.getPath(), o);
            int amostra = 1; while (Math.max(o.outWidth, o.outHeight) / amostra > 2600) amostra *= 2;
            o = new BitmapFactory.Options(); o.inSampleSize = amostra;
            Bitmap b = BitmapFactory.decodeFile(f.getPath(), o);
            if (b == null) throw new Exception("imagem");
            sb.append(Tasks.await(leitor.process(InputImage.fromBitmap(b, 0))).getText());
            b.recycle();
        }
        return sb.toString();
    }

    @PluginMethod
    public void pegarCompartilhado(PluginCall call) {
        JSObject r = new JSObject();
        synchronized (this) {
            JSArray a = new JSArray();
            for (JSObject o : compartilhados) a.put(o);
            compartilhados.clear();
            r.put("itens", a);
            r.put("lendo", lendo > 0);
        }
        call.resolve(r);
    }
}
