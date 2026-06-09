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

Escolha uma senha/token forte. Exemplo de padrão:

```text
Emulsao@2026#TroqueEsteToken
```

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

- Lê a planilha OneDrive/SharePoint.
- Atualiza cache do dashboard no Firestore.
- Atualiza automaticamente a cada 2 minutos.
- Permite alterar o link da planilha no painel admin.
- Envia email para `thiago.ferreira@enaex.com` se a planilha falhar.
- Exibe gráfico de linhas da aplicação dia a dia.
