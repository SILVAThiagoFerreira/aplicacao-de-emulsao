# INICIAR AQUI NO CODEX

Este pacote já está configurado para o Firebase `aplicacao-de-emulsao`, mas **não depende de Firebase Authentication**.

Como você não tem acesso ao Authentication, o painel administrativo foi ajustado para funcionar com um **token secreto** guardado no Firebase Functions Secret Manager.

## Rodar no computador

```bash
npm install
npm run dev
```

No Windows, também pode usar:

```text
scripts/iniciar-windows.bat
```

## Configurar Firebase sem Authentication

Você precisa ter acesso a Firestore e Cloud Functions.

1. Criar o banco Firestore no Firebase Console.
2. Configurar o token administrativo:

```bash
firebase login
firebase use aplicacao-de-emulsao
firebase functions:secrets:set ADMIN_PANEL_TOKEN
```

Escolha um token forte e mantenha o valor somente no Firebase Functions Secret Manager. Não registre o token em documentação, código, GitHub ou arquivos `.env`.

3. Configurar email de alerta por SendGrid:

```bash
firebase functions:secrets:set SENDGRID_API_KEY
firebase functions:secrets:set SENDGRID_FROM
```

4. Criar a configuração inicial no Firestore:

```bash
npm run seed
```

5. Publicar Functions e regras:

```bash
firebase deploy --only functions,firestore:rules,firestore:indexes
```

O projeto Firebase atualmente está no plano Spark. O Firebase bloqueia o deploy de Cloud Functions nesse plano; para ativar o botão **Atualizar Dados** e o monitoramento de 2 minutos, ative o Blaze e então execute o comando acima com uma identidade autorizada. Enquanto isso, o workflow hospedado do GitHub Actions sincroniza a planilha a cada 5 minutos, atualiza o Firestore e publica o cache do Pages sem depender do PC.

## Como acessar o admin

Abra:

```text
#/admin
```

Digite o mesmo token configurado em:

```bash
firebase functions:secrets:set ADMIN_PANEL_TOKEN
```

## Importante

Não coloque o token dentro do código, GitHub ou arquivos `.env`.

O front-end apenas pede o token no painel. A validação acontece no backend, dentro das Cloud Functions.

## O que o painel faz

- O botão **Atualizar Dados** chama a Cloud Function protegida, lê a planilha configurada e aguarda a confirmação do cache no Firestore.
- O monitoramento automático ocorre a cada 2 minutos pela Cloud Function quando o Blaze está ativo; no Spark, o GitHub Actions hospedado executa a sincronização a cada 5 minutos.
- O front-end publicado escuta `dashboard/cache` em tempo real e usa o JSON do Pages como fallback.
- O n8n pode chamar o endpoint protegido `syncDashboard`, mas é opcional.
- Permite alterar o link da planilha no painel admin.
- Envia email para `thiago.ferreira@enaex.com` se a planilha falhar.
- Exibe gráfico de linhas da aplicação dia a dia.
