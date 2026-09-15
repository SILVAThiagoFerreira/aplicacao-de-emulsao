# Dashboard de Emulsão | Enaex

Dashboard da aplicação de emulsão da US Vale Verde, com demonstrativo diário, filtros, justificativas, aplicações mensais, aplicação por UMB, projeção e exportação de relatório.

## Arquitetura atual: gratuita e sem dependência do PC

O caminho publicado usa somente recursos gratuitos:

- **Interface:** React + Vite hospedado no GitHub Pages.
- **Fonte:** exportação XLSX do Google Sheets/Google Drive.
- **Atualização automática:** GitHub Actions hospedado, a cada 5 minutos.
- **Atualização manual:** o botão **Atualizar Dados** baixa a planilha diretamente no navegador, interpreta o XLSX e atualiza a tela imediatamente.
- **Cache público:** `web/public/dashboard-cache.json`, republicado pelo GitHub Actions para os demais visitantes.
- **Computador e n8n:** não são necessários para a rotina online.
- **Firebase Blaze/Cloud Functions:** não são usados no caminho atual e não precisam ser ativados.

O intervalo automático de 5 minutos é o menor intervalo confiável do agendamento nativo do GitHub Actions. O botão manual não espera esse intervalo: ele faz a leitura direta da planilha no momento do clique.

```text
Google Sheets / Drive
       ├── clique em "Atualizar Dados" ──> navegador lê XLSX e atualiza esta tela
       └── a cada 5 minutos ─────────────> GitHub Actions processa e publica o cache
                                                        ↓
                                          GitHub Pages / dashboard-cache.json
```

## Botão Atualizar Dados

O botão pede uma **senha administrativa** como confirmação da ação e aceita que o usuário digite `admin`. O texto digitado não é salvo, não é incluído no bundle e não é enviado para nenhum servidor: a planilha é somente lida pelo navegador.

Como o GitHub Pages é um site estático, não existe um servidor gratuito escondido para validar uma senha secreta. Portanto, neste desenho a senha é uma confirmação de uso, e não um mecanismo de segurança. Como a planilha precisa estar acessível para a exportação pública, não use essa confirmação para proteger dados confidenciais.

Após a leitura manual, o painel atual é atualizado na hora. O cache que será visto por novos visitantes é republicado pelo GitHub Actions na próxima execução automática.

## Requisitos da fonte

O link da planilha inicial está configurado em `web/src/App.jsx` e no workflow:

```text
https://docs.google.com/spreadsheets/d/1OGBE4wurFr0ZdsrU57dxPDF2M7IYwaLL/edit
```

A planilha precisa permitir a exportação XLSX sem login no navegador. O parser procura as abas e cabeçalhos de aplicação, ritmo/projeção, metas e justificativas, mantendo a mesma lógica usada no cache automático.

## Rodar localmente

```bash
npm install
npm run dev
```

Para validar a build de produção:

```bash
npm run build
```

O servidor de preview pode ser iniciado com:

```bash
npm run preview
```

## Publicar no GitHub Pages

1. Envie o projeto para um repositório GitHub público.
2. Em **Settings > Pages**, selecione **GitHub Actions** como origem.
3. Faça push na branch `main`.
4. O workflow `.github/workflows/deploy-pages.yml` fará o download da planilha, gerará `web/public/dashboard-cache.json`, executará a build e publicará o Pages.

O workflow não precisa de `FIREBASE_SERVICE_ACCOUNT_JSON`, token GitHub, n8n ou segredo de cobrança. O repositório público usa os minutos gratuitos do GitHub Actions.

## Estrutura principal

```text
web/                         aplicação React + Vite
web/src/lib/parseWorkbook.js parser XLSX usado no navegador
functions/lib/parseWorkbook.js parser usado pelos scripts legados
web/public/dashboard-cache.json cache estático publicado
scripts/update-dashboard-cache.mjs gerador do cache automático
.github/workflows/deploy-pages.yml atualização e publicação hospedadas
sample/                      planilha de referência
docs/                        referência visual e instruções
```

Os arquivos `functions/`, `firestore.rules` e os scripts Firebase antigos permanecem no repositório para referência/compatibilidade histórica, mas não fazem parte do fluxo gratuito publicado. Não é necessário executar `firebase deploy`, configurar Blaze ou manter o n8n ligado.

## Verificações

```bash
npm run build
node web/test-filter.js
node --check functions/index.js
```

O build da aplicação e o teste dos filtros devem passar antes de publicar alterações.
