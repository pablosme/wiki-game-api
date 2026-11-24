# Política de Privacidade — Wikipedia Game

**Última atualização:** 24 de novembro de 2026

A extensão **Wikipedia Game** respeita a sua privacidade. Esta política descreve de forma transparente quais dados são processados durante o uso da extensão.

## 1. Dados coletados e finalidade
A extensão **não exige cadastro** e **não coleta dados pessoais identificáveis** (como nome, e-mail, localização ou histórico geral de navegação).

Durante uma **partida ativa** na Wikipédia (`*.wikipedia.org`), a extensão processa apenas:
- **Caminho da partida (Histórico da Web limitado à partida):** a lista de títulos de artigos da Wikipédia visitados exclusivamente dentro da aba da partida ativa, desde o artigo inicial até o artigo objetivo.

Esses dados são enviados para a API do jogo (`wikipedia-game-api.pablosme9.workers.dev`) **exclusivamente** para:
1. Validar se os links percorridos existem na Wikipédia;
2. Aplicar os modificadores do round e calcular a pontuação final da partida.

## 2. Armazenamento e processamento Stateless
- **No servidor (API):** o processamento é **100% stateless**. Nenhuma partida, caminho percorrido ou dado de navegação é armazenado em banco de dados ou vinculado à identidade do usuário. Os dados são descartados imediatamente após o cálculo da resposta.
- **No navegador (local):** o estado temporário da partida em andamento é mantido localmente em `chrome.storage.session` apenas enquanto a sessão do navegador está aberta.

## 3. Compartilhamento e venda de dados
- Não vendemos, alugamos ou compartilhamos dados de usuários com terceiros.
- Não utilizamos anúncios, cookies de rastreamento ou ferramentas de analytics.

## 4. Contato
Em caso de dúvidas sobre esta Política de Privacidade, entre em contato pelo e-mail: **[seu-email@exemplo.com]**

---

# Privacy Policy — Wikipedia Game

**Last updated:** November 24, 2026

The **Wikipedia Game** browser extension respects your privacy. This policy explains what data is processed when you use the extension.

## 1. Data Collected and Purpose
The extension **does not require an account** and **does not collect personally identifiable information** (such as name, email address, location, or general browsing history).

During an **active game round** on Wikipedia (`*.wikipedia.org`), the extension processes only:
- **Match path (Web History limited to the active round):** the list of Wikipedia article titles visited exclusively within the active game tab, from the starting article to the target article.

This data is sent to the game API (`wikipedia-game-api.pablosme9.workers.dev`) **solely** to:
1. Validate that the clicked links exist on Wikipedia;
2. Apply round modifiers and calculate the final match score.

## 2. Stateless Processing and Storage
- **Server-side (API):** processing is **100% stateless**. No match data, visited paths, or browsing activity is stored in any database or linked to user identity. Data is discarded immediately after computing the response.
- **Browser-side (local):** active match state is stored temporarily in `chrome.storage.session` only for the duration of the browser session.

## 3. Data Sharing and Sale
- We do not sell, rent, or transfer user data to third parties.
- We do not use advertisements, tracking cookies, or third-party analytics.

## 4. Contact
If you have any questions about this Privacy Policy, please contact: **[seu-email@exemplo.com]**