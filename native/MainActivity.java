package br.com.tavares.financeiro;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AvisosBancosPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
