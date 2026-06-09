# Instruções para agentes Codex

Este projeto não usa Firebase Authentication.

## Regra principal

Não adicionar Firebase Auth. O usuário não tem acesso a Authentication.

## Admin

O painel administrativo usa o secret:

```text
ADMIN_PANEL_TOKEN
```

Esse token deve ser configurado no Firebase Functions Secret Manager:

```bash
firebase functions:secrets:set ADMIN_PANEL_TOKEN
```

O token nunca deve ser salvo no código, no GitHub ou em `.env`.

## Segurança

- O browser pode ler `app/config`, `dashboard/cache` e `monitor/status`.
- O browser não pode escrever diretamente no Firestore.
- Alterações administrativas passam por Cloud Functions.
- Cloud Functions validam `ADMIN_PANEL_TOKEN`.

## Comandos

```bash
npm install
npm run dev
npm run build
npm run seed
firebase deploy --only functions,firestore:rules,firestore:indexes
```

## Visual

Manter padrão corporativo clean Enaex/McKinsey, com vermelho, cinza e fundo claro.
