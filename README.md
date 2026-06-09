# Dashboard de Emulsão | Enaex

Projeto pronto para rodar localmente, publicar o front-end no GitHub Pages e usar Firebase como banco e backend de monitoramento.

A aplicação foi montada a partir do material zipado, mantendo a lógica do painel da imagem de referência: demonstrativo diário, filtros, aplicação mensal, aplicação por UMB e projeção mensal.

## Arquitetura

- **Front-end:** React + Vite + Recharts, pronto para GitHub Pages.
- **Banco:** Firestore com `dashboard/cache` como JSON online.
- **Login admin:** token secreto validado nas Cloud Functions.
- **Monitoramento da planilha:** GitHub Actions a cada 5 minutos.
- **Email de falha:** SendGrid via Cloud Functions, opcional.
- **Planilha original:** OneDrive/SharePoint, configurável no painel admin.

## Estrutura principal

```text
web/                 front-end React
functions/           Firebase Cloud Functions
firestore.rules      regras de segurança do Firestore
.github/workflows/   publicação automática no GitHub Pages
sample/              planilha de referência do material zipado
docs/                imagem de referência e instruções Codex
AGENTS.md            instruções para Codex/agent
```

## Rodar no computador

```bash
npm install
cp web/.env.example web/.env.local
npm run dev
```

Abra o endereço mostrado pelo Vite. Sem as chaves Firebase preenchidas, o painel roda com dados de amostra extraídos do arquivo enviado.

## Configurar Firebase

1. Crie um projeto no Firebase.
2. Ative **Cloud Firestore**.
3. Copie as chaves do app Web do Firebase para `web/.env.local`.
4. Copie `.firebaserc.example` para `.firebaserc` e coloque o ID do projeto.

Exemplo de `web/.env.local`:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=seu-projeto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=seu-projeto
VITE_FIREBASE_STORAGE_BUCKET=seu-projeto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FUNCTIONS_REGION=southamerica-east1
VITE_ADMIN_EMAILS=thiago.ferreira@enaex.com
```

## Criar o admin

Faça login no painel em `#/admin`, informe o token administrativo e configure o segredo no Firebase Functions Secret Manager:

```bash
firebase functions:secrets:set ADMIN_PANEL_TOKEN
```

Depois rode o seed, se quiser popular a configuração inicial:

```bash
export FIREBASE_PROJECT_ID=seu-projeto
export ADMIN_EMAIL=thiago.ferreira@enaex.com
npm run seed
```

O seed cria `app/config` e os documentos necessários para o painel. As alterações administrativas continuam protegidas pelo token secreto.

## Deploy das regras e funções

```bash
firebase login
firebase use seu-projeto
firebase deploy --only functions,firestore:rules,firestore:indexes
```

No fluxo online, o GitHub Actions baixa a planilha, grava `dashboard/cache` no Firestore e o front lê esse documento em tempo real.

## Email de alerta

O projeto usa SendGrid. Configure os secrets:

```bash
firebase functions:secrets:set SENDGRID_API_KEY
firebase functions:secrets:set SENDGRID_FROM
```

`SENDGRID_FROM` precisa ser um remetente verificado no SendGrid. O destinatário padrão é:

```text
thiago.ferreira@enaex.com
```

Também é possível editar o destinatário pelo painel admin.

## Link da planilha

O link inicial configurado é:

```text
https://empresassk-my.sharepoint.com/:x:/g/personal/jose_queiroz_enaex_com/IQBOjdbs_K8tTKIXFm3nd_9LAUp1C8FrYgMroBbug01U3A4?e=whRgaf
```

O sistema tenta baixar o arquivo adicionando `download=1`. Se o SharePoint exigir login ou bloquear o download externo, o workflow do GitHub Actions falhará e o Pages continuará servindo o último cache publicado.

## Publicar no GitHub Pages

1. Suba este projeto para um repositório GitHub.
2. Em **Settings > Pages**, selecione **GitHub Actions**.
3. Em **Settings > Secrets and variables > Actions**, cadastre:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

4. Faça push na branch `main`. O workflow `.github/workflows/deploy-pages.yml` fará o build e publicará o painel.

## Observação importante

GitHub Pages hospeda só a interface. O estado real do dashboard fica no Firestore em `dashboard/cache`. O workflow do GitHub Actions atualiza esse documento online a cada 5 minutos.

## Atualização adicionada

- Gráfico de linhas **EMULSÃO: Aplicação Dia a Dia**, filtrado pelos mesmos campos do dashboard.


## Firebase já configurado

Este pacote já está apontado para o projeto Firebase:

```text
projectId: aplicacao-de-emulsao
authDomain: aplicacao-de-emulsao.firebaseapp.com
storageBucket: aplicacao-de-emulsao.firebasestorage.app
```

Arquivos configurados:

```text
web/.env.local
web/.env.production
.firebaserc
.github/workflows/deploy-pages.yml
```

Antes de publicar, confira no Firebase Console:

```text
1. Firestore Database: criar o banco em modo produção.
2. Firestore > rules: publicar as regras do projeto.
3. Configurar `ADMIN_PANEL_TOKEN` no Secret Manager.
```

Para rodar localmente:

```bash
npm install
npm run dev
```

Para implantar Firebase Functions e regras:

```bash
firebase login
firebase use aplicacao-de-emulsao
firebase deploy --only functions,firestore:rules,firestore:indexes
```

## Secret do GitHub Actions

Para o workflow gravar no Firestore, cadastre em **Settings > Secrets and variables > Actions**:

```text
FIREBASE_SERVICE_ACCOUNT_JSON
```

Esse secret deve conter o JSON completo de uma service account com permissão de escrita no Firestore do projeto `aplicacao-de-emulsao`.

## Pacote pronto para Codex

Este ZIP já foi preparado para abrir diretamente no Codex ou no VS Code.

Use como ponto de partida:

```text
INICIAR_AQUI_CODEX.md
docs/PROMPT_PARA_CODEX.txt
AGENTS.md
```

Firebase já configurado no front-end:

```text
projectId: aplicacao-de-emulsao
authDomain: aplicacao-de-emulsao.firebaseapp.com
measurementId: G-S85JJRWHK1
```

Scripts rápidos no Windows:

```text
scripts/iniciar-windows.bat
scripts/build-windows.bat
scripts/deploy-firebase-windows.bat
```

O pacote não inclui secrets privados, como chave SendGrid, senha de email, token GitHub ou service account. Esses itens devem ser configurados no Firebase/GitHub como secrets.

O painel admin usa um token secreto validado nas Cloud Functions:

```bash
firebase functions:secrets:set ADMIN_PANEL_TOKEN
```

O Firestore permite leitura pública dos dados do painel, mas bloqueia escrita direta pelo navegador. As alterações administrativas são feitas pelas funções `updateConfig` e `refreshWorkbook`.
