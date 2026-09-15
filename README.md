# Dashboard de Emulsão | Enaex

Projeto pronto para rodar localmente, publicar o front-end no GitHub Pages e usar Firebase como banco e backend de monitoramento.

A aplicação foi montada a partir do material zipado, mantendo a lógica do painel da imagem de referência: demonstrativo diário, filtros, aplicação mensal, aplicação por UMB e projeção mensal.

## Arquitetura

- **Front-end:** React + Vite + Recharts, pronto para GitHub Pages.
- **Banco:** Firestore com `dashboard/cache` como JSON online.
- **Login admin:** token secreto validado nas Cloud Functions.
- **Monitoramento da planilha:** Cloud Functions a cada 2 minutos quando o backend Firebase está no Blaze; o GitHub Actions hospedado mantém a sincronização de contingência a cada 5 minutos.
- **Atualização manual:** botão **Atualizar Dados**, protegido por `ADMIN_PANEL_TOKEN`, lê a planilha na nuvem e confirma a gravação no Firestore.
- **Atualização do navegador:** Firestore em tempo real, sem novo deploy do Pages para cada alteração de dados.
- **n8n:** integração opcional por endpoint protegido; não é necessário manter um PC ligado.
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

No fluxo online, a Cloud Function agendada baixa a planilha, interpreta os dados e grava `dashboard/cache` no Firestore. O front-end publicado mantém um listener em tempo real nesse documento, portanto uma alteração de dados não exige novo build ou novo deploy do GitHub Pages.

O botão **Atualizar Dados** chama a função `refreshWorkbook`, envia o token somente por HTTPS e aguarda a confirmação de `monitor/status`. O token nunca é salvo no navegador, no código ou no GitHub. Como o projeto Firebase está no plano Spark, a publicação das Functions fica bloqueada pelo próprio Firebase; para habilitar o botão manual e o monitoramento de 2 minutos, é necessário ativar o plano Blaze. Até essa ativação, o workflow hospedado continua atualizando o Firestore e o cache do Pages sem depender do PC ou do n8n.

## Atualização automática sem depender do PC

O fluxo de dados em produção é:

```text
Planilha Google Sheets
        ↓ a cada 5 minutos
GitHub Actions hospedado
        ↓
dashboard/cache no Firestore + dashboard-cache.json
        ↓ listener onSnapshot / fallback Pages
Dashboard no GitHub Pages
```

O GitHub Pages hospeda somente o código da interface e um cache estático de fallback. O workflow não precisa de um computador ligado: ele baixa a planilha, processa os dados, grava o Firestore e publica o cache estático. Depois que o Blaze estiver ativo e as Functions forem publicadas, o monitoramento nativo de 2 minutos e o botão manual passam a operar pelo Firebase. O n8n pode chamar o endpoint protegido `syncDashboard`, mas não é requisito do site.

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
https://docs.google.com/spreadsheets/d/1OGBE4wurFr0ZdsrU57dxPDF2M7IYwaLL/edit?usp=sharing&ouid=106130974941027428781&rtpof=true&sd=true
```

O sistema tenta baixar o arquivo no formato `xlsx` usando exportação do Google Sheets. Se a planilha exigir login ou restringir o download, a Cloud Function registra a falha em `monitor/status`, envia o alerta configurado e preserva o último cache válido no Firestore.

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
VITE_DASHBOARD_API_URL
```

4. Cadastre também `FIREBASE_SERVICE_ACCOUNT_JSON` para que o workflow consiga gerar o cache e gravar `dashboard/cache` no ambiente hospedado. O deploy das Functions é uma etapa administrativa separada.
5. Faça push na branch `main`. O workflow `.github/workflows/deploy-pages.yml` baixa a planilha, grava o cache do Firestore, atualiza o fallback estático e faz o deploy do Pages.

## Observação importante

GitHub Pages hospeda só a interface. O estado real do dashboard fica no Firestore em `dashboard/cache`, atualizado pelo workflow hospedado a cada 5 minutos enquanto o projeto estiver no Spark ou pela Cloud Function a cada 2 minutos após a ativação do Blaze. O navegador recebe alterações por listener em tempo real, sem depender do computador do administrador.

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

## Secret usado pelo workflow hospedado

O workflow usa a credencial abaixo para gravar o cache no Firestore e gerar o cache inicial no GitHub Actions. O arquivo temporário existe somente durante a execução hospedada; ele não precisa ficar no seu PC nem no Git:

```text
FIREBASE_SERVICE_ACCOUNT_JSON
```

Esse valor deve conter o JSON completo de uma service account com permissão de deploy no projeto `aplicacao-de-emulsao`. Nunca grave o JSON em código, Git ou arquivo público. Para executar `npm run refresh:cache` manualmente, use a mesma variável de ambiente.

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
