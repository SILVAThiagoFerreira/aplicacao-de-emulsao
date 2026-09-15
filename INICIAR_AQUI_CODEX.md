# Iniciar o Dashboard de Emulsão

## Caminho recomendado, sem custo

Este projeto roda com GitHub Pages + GitHub Actions + Google Sheets. Não depende de Firebase Blaze, Cloud Functions, n8n ou do computador do administrador.

O GitHub Actions atualiza o cache hospedado a cada 5 minutos. O botão **Atualizar Dados** lê a planilha XLSX diretamente no navegador e atualiza a tela imediatamente.

## Rodar localmente

```bash
npm install
npm run dev
```

Para validar:

```bash
npm run build
node web/test-filter.js
```

## Publicar

1. Faça push na branch `main`.
2. No GitHub, abra **Settings > Pages**.
3. Selecione **GitHub Actions**.
4. Aguarde a execução de `.github/workflows/deploy-pages.yml`.

O workflow baixa a planilha configurada, gera `web/public/dashboard-cache.json`, compila a aplicação e publica o GitHub Pages. Não é necessário cadastrar token de Firebase, service account, token GitHub ou segredo de cobrança.

## Atualização manual

No dashboard:

1. Clique em **Atualizar Dados**.
2. Digite a senha de confirmação, por exemplo `admin`.
3. Clique em **Confirmar atualização**.

A planilha é baixada diretamente do Google Sheets, interpretada no navegador e aplicada à tela atual. O texto digitado não é salvo nem enviado para nenhum serviço.

Esta senha é somente uma confirmação local. Sites estáticos não conseguem validar uma senha secreta sem um backend; por isso, ela não deve ser tratada como controle de segurança para dados que não sejam públicos.

## Limites intencionais do desenho gratuito

- O clique atualiza a tela aberta imediatamente.
- O cache público para novos acessos é atualizado pela próxima execução do GitHub Actions, em até aproximadamente 5 minutos.
- A exportação XLSX da planilha precisa estar acessível sem login no navegador.
- Não é necessário deixar o PC ligado.
- Não é necessário iniciar o n8n.

## Arquivos importantes

- `web/src/App.jsx`: leitura manual direta e interface.
- `web/src/lib/parseWorkbook.js`: parser XLSX executado no navegador.
- `scripts/update-dashboard-cache.mjs`: geração do cache para o workflow.
- `.github/workflows/deploy-pages.yml`: sincronização automática e publicação.
- `web/public/dashboard-cache.json`: fallback estático.

Os arquivos de Firebase/Cloud Functions foram mantidos por compatibilidade histórica, mas não são necessários para o fluxo publicado e gratuito.
