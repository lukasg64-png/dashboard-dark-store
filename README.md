# 🏪 DARK Store — Painel de Performance Executiva & Atingimento de Metas

Painel executivo de performance para a **Porto Alegre Dark Store** integrado via WebSocket Engine API com o **Qlik Sense Enterprise**, exibindo métricas consolidadas de vendas, atingimento de metas, comparativo MoM (mesmo período decorrido 01 a D-1), detalhamento por canal de venda (share e variação p.p.) e mix por categoria de produtos.

---

## 🛠️ Tecnologias Utilizadas

- **Backend**: Node.js, Express, WebSocket (`ws`), Enigma.js (`enigma.js`), XLSX.
- **Frontend**: HTML5 Semântico, CSS3 Moderno (Variáveis de Design System Dark Mode), Vanilla JavaScript, Chart.js, Chart.js Datalabels.
- **Integração Qlik**: Qlik Sense Engine API via WebSocket com Form Authentication (ticket auth) e Set Analysis determinístico.

---

## 🚀 Como Executar Localmente

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar a aplicação
npm start

# 3. Acesse no navegador
http://localhost:8094
```

---

## ☁️ Deploy no Render.com

O projeto já conta com o arquivo `render.yaml` pronto para deploy na nuvem no **Render.com**.

### Comandos Git para subir no GitHub:
```bash
git remote add origin https://github.com/SEU_USUARIO/dashboard-dark-store.git
git branch -M main
git push -u origin main
```

No **Render.com**, crie um **Web Service** selecionando este repositório do GitHub. O Render iniciará a aplicação automaticamente!
