# AI Workspace

Uma camada intermediária minimalista entre **qualquer modelo de IA** e os **seus repositórios do GitHub**. Cole sua chave de API, conecte seu GitHub com um Personal Access Token e converse: a IA lê, pesquisa, refatora e propõe alterações no seu código — e **nada é aplicado sem a sua aprovação explícita**.

<p>
  <img src="public/icon.svg" width="64" alt="AI Workspace" />
</p>

## Como funciona

1. **Cofre local** — na primeira abertura você cria uma senha. Todas as chaves (API keys e token do GitHub) são criptografadas com AES-256-GCM (chave derivada por PBKDF2) e ficam **somente no seu dispositivo**. Nenhum servidor intermediário: o app conversa direto com a API da IA e com a API do GitHub a partir do seu navegador/dispositivo.
2. **Conecte uma IA** — escolha o provedor, cole a chave, pronto. Você pode salvar várias IAs e alternar entre elas a qualquer momento (inclusive usar uma diferente por conversa).
3. **Conecte o GitHub** — cole um Personal Access Token com os escopos **que você decidir conceder**. O app lista seus repositórios; selecione um ou vários e defina a permissão da IA em cada um: `somente leitura`, `leitura e escrita` ou `total (branches/PRs)`.
4. **Converse** — peça coisas como:
   - “Crie um sistema de login.”
   - “Corrija todos os bugs deste projeto.”
   - “Refatore toda a arquitetura.”
   - “Crie uma nova branch e implemente esta funcionalidade e abra um PR.”
5. **Aprove ou rejeite** — a IA explora o código (listar/ler/pesquisar arquivos) e, quando quer alterar algo, envia uma **proposta**: um commit atômico com diff completo de cada arquivo, opcionalmente com branch nova e Pull Request. Você revisa o diff no painel *Alterações* e clica em **Aprovar** (executa no GitHub) ou **Rejeitar** (descarta). Tudo fica registrado no *Histórico*.

## Provedores suportados

| Provedor | Formato |
|---|---|
| Anthropic (Claude) | API Messages nativa |
| OpenAI | Chat Completions |
| Google Gemini | endpoint compatível com OpenAI |
| Grok (xAI) | Chat Completions |
| DeepSeek | Chat Completions |
| OpenRouter | Chat Completions (acesso a centenas de modelos) |
| Mistral | Chat Completions |
| **API customizada** | qualquer endpoint compatível com OpenAI (Ollama, LM Studio, vLLM, proxies…) |

O campo de modelo é livre — use qualquer modelo que sua chave tenha acesso.

## O que a IA consegue fazer

- Listar e ler arquivos de qualquer branch dos repositórios liberados
- Pesquisar código em todo o projeto
- Criar, editar e apagar arquivos (via proposta aprovada)
- Fazer commits com múltiplos arquivos (Git Data API)
- Criar branches
- Abrir Pull Requests
- Trabalhar em vários repositórios na mesma conversa
- Criar projetos do zero (crie um repositório vazio no GitHub e peça)

## Segurança

- Chaves criptografadas localmente (AES-256-GCM + PBKDF2 com 310 mil iterações); sem senha, sem acesso.
- Zero backend: nenhuma chave ou código passa por servidores do app.
- Permissão por repositório: a IA só propõe escrita onde você permitiu.
- **Aprovação obrigatória**: a ferramenta de escrita da IA apenas enfileira propostas; o único caminho até o GitHub é o botão *Aprovar* clicado por você.
- O escopo do token do GitHub é decidido por você na criação do token.

## Rodando

```bash
npm install
npm run dev      # desenvolvimento (http://localhost:5173)
npm run build    # produção (gera dist/)
npm run preview  # serve o build
```

## Desktop e mobile

O app é um **PWA responsivo**:

- **Desktop**: sirva o `dist/` (ou hospede em qualquer estático — Vercel, Netlify, GitHub Pages) e use “Instalar aplicativo” no Chrome/Edge para tê-lo como app de janela própria. Para um binário nativo, o projeto empacota direto com [Tauri](https://tauri.app) (`npx tauri init` apontando para `dist/`).
- **Mobile**: abra no navegador e use “Adicionar à tela inicial” (iOS/Android) — o manifesto PWA já está configurado. Para lojas de aplicativos, empacote com [Capacitor](https://capacitorjs.com) (`npx cap init` + `npx cap add android|ios` usando `dist/` como webDir).

## Arquitetura

```
src/
├── lib/
│   ├── providers.ts   # adaptadores de IA (Anthropic + compatíveis com OpenAI)
│   ├── agent.ts       # ferramentas do agente + loop de execução + propostas
│   ├── github.ts      # cliente REST do GitHub (PAT)
│   ├── crypto.ts      # cofre local criptografado (WebCrypto)
│   └── store.tsx      # estado global persistido (localStorage)
├── components/
│   ├── Sidebar.tsx    # IAs, GitHub, repositórios, conversas
│   ├── Chat.tsx       # chat principal
│   ├── ChangesPanel.tsx # propostas com diff + aprovar/rejeitar
│   ├── FilesPanel.tsx # navegador de arquivos
│   ├── HistoryPanel.tsx # histórico de commits/PRs/rejeições
│   ├── DiffView.tsx   # diff linha a linha
│   └── VaultGate.tsx  # criação/destravamento do cofre
└── App.tsx            # layout responsivo (desktop 3 colunas, mobile abas)
```

Extensível por design: para adicionar um provedor basta um preset em `providers.ts`; para dar novas capacidades à IA, uma nova ferramenta em `agent.ts`.
