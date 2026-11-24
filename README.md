# wikipedia-game-api

API Serverless Stateless e Pipeline do Pool de Artigos para o projeto **wikipedia-game**.

---

## Stack Tecnológica

- **Linguagem:** TypeScript (Node.js / Web Standards)
- **Framework HTTP:** Hono (agnóstico de plataforma, compatível com Cloudflare Workers, Node.js, Vercel e AWS Lambda)
- **Autenticação de Partida:** JWT (`HMAC-SHA256` via Web Crypto API)

---

## Endpoints

### `GET /health`
Verifica a disponibilidade do serviço.

### `GET /game/pool-info`
Retorna a quantidade de artigos carregados em `pool-pt.json` e `pool-en.json` por faixa de conectividade (`tier1`, `tier2`, `tier3`).

### `POST /game/start`
Inicia uma partida no modo **Jogo Livre (`free`)** ou **Desafio do Dia (`daily`)** e retorna um token JWT assinado.

### `POST /game/finish`
Recebe `{ token, path }`, valida o JWT, verifica os limites customizáveis, consulta a **MediaWiki Action API** para confirmar cada transição `Artigo A -> Artigo B` e calcula a pontuação final a partir da base de **1.000 pontos**.

---

## Comandos

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Execute os testes automatizados:
   ```bash
   npm test
   ```
3. Inicie o servidor local em Node.js:
   ```bash
   npm run dev
   ```
4. Atualize os pools estáticos (`pool-pt.json` e `pool-en.json`) via pipeline automatizada:
   ```bash
   npm run build:pool -- --lang=all --limit=5000
   ```
