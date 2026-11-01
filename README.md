# Controle financeiro · Bruno Tavares

App Android que junta as entradas da Tijolos Tavares com as notificações dos bancos,
separa empresa e pessoal, mostra o lucro de cada carga e cobra as entregas sem recebimento.

## Como sai o APK

Cada envio pro GitHub monta o APK sozinho (aba **Actions**). Quando entra no ramo `main`,
ele também é publicado em **Releases**: abra a página no celular, baixe o
`FinanceiroTavares.apk` e toque nele.

## Primeira vez no celular

1. Entre com o mesmo e-mail e senha de administrador do app da Tijolos.
2. Toque em **Abrir ajustes** e ative **Financeiro Tavares** na lista de acesso a notificações.
3. Se o Android disser que é uma configuração restrita: Configurações › Apps ›
   Financeiro Tavares › três pontinhos › **Permitir configurações restritas**, e volte no passo 2.
4. Deixe o app mandar notificações (é por elas que chegam os alertas vermelhos).

## O que tem dentro

- `www/` é o app (HTML, CSS e JavaScript).
  - `leitura.js` entende as notificações dos bancos e os extratos (CSV/OFX).
  - `regras.js` decide categorias, liga Pix às entregas, calcula alertas, fichas e resumos.
  - `app.js` são as telas.
- `native/` é o código Android que lê as notificações dos bancos.
- `testes/` roda com `npm test`.
- O banco de dados é o mesmo Supabase da Tijolos (tabelas `fin_*`, só o administrador acessa).
