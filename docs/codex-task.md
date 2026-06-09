# Tarefa Codex recomendada

Melhore e mantenha este dashboard seguindo estes critérios:

1. Rodar localmente com `npm install` e `npm run dev`.
2. Publicar o front-end em GitHub Pages.
3. Usar `ADMIN_PANEL_TOKEN` para login administrativo.
4. Usar Firestore para armazenar:
   - `app/config`: link da planilha, email de alerta e configurações.
   - `dashboard/cache`: registros parseados e agregados.
   - `monitor/status`: status da última atualização.
   - `admins/{uid}`: usuários autorizados.
5. Usar Firebase Cloud Functions para:
   - baixar a planilha OneDrive/SharePoint;
   - atualizar o cache a cada 2 minutos;
   - disparar email via SendGrid quando houver falha.
6. Manter o painel visual parecido com `docs/dashboard-referencia.png`.

Antes de alterar o código, execute `npm run build` para validar a versão atual.
