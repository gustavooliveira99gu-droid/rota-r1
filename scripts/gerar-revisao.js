// ============================================================
// Rota R1 - Gerador da rota /api/revisao
// Roda via GitHub Action (não altera o app principal do Dashboard)
// ============================================================

const https = require("https");
const fs = require("fs");
const path = require("path");

const GIST_ID = "0714649d689528eb887ea87b220366f9";
const ARQUIVO_NO_GIST = "rota-r1-data.json";
const RAW_URL = `https://gist.githubusercontent.com/gustavooliveira99gu-droid/${GIST_ID}/raw/${ARQUIVO_NO_GIST}`;

function buscarJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "rota-r1-bot" } }, (res) => {
        // Segue redirecionamento (o /raw/ do gist redireciona pra versão mais recente)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(buscarJSON(res.headers.location));
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("Resposta não é JSON válido: " + data.slice(0, 200)));
          }
        });
      })
      .on("error", reject);
  });
}

// Data de hoje no fuso de Brasília, formato YYYY-MM-DD (mesmo formato usado no app)
function hojeISO() {
  return new Date()
    .toLocaleString("en-CA", { timeZone: "America/Sao_Paulo" })
    .slice(0, 10);
}

function diasAtraso(hoje, next) {
  if (!next) return 0;
  const diff = (new Date(hoje) - new Date(next)) / 86400000;
  return Math.max(0, Math.round(diff));
}

function scorePrioridade(hoje, t) {
  const atraso = diasAtraso(hoje, t.next);
  const rankBonus = t.examRank ? (11 - t.examRank) * 1.3 : 0;
  const impScore = (t.imp || 0) * 1.5;
  const incScore = t.inc || 0;
  const desempenhoScore = t.lastRevAcc != null ? (100 - t.lastRevAcc) * 0.3 : 0;
  const boost = t.boost || 0;
  return atraso * 2 + rankBonus + impScore + incScore + desempenhoScore + boost;
}

// Quantidade de questões recomendada, seguindo o config.revQ / config.thr do próprio Dashboard
function questoesRecomendadas(config, topico) {
  const revQ = config?.revQ || { low: 15, mid: 10, high: 5 };
  const thr = config?.thr || { low: 60, high: 80 };
  const acc = topico.lastRevAcc;
  if (acc == null) return revQ.mid;
  if (acc < thr.low) return revQ.low;
  if (acc < thr.high) return revQ.mid;
  return revQ.high;
}

async function principal() {
  const dados = await buscarJSON(RAW_URL);
  const hoje = hojeISO();

  // Só entram tópicos que já têm ciclo de revisão ativo (stage definido)
  const topicos = (dados.topics || []).filter(
    (t) => t.stage !== null && t.stage !== undefined
  );

  // 1ª tentativa: revisões vencidas (next <= hoje)
  let candidatos = topicos.filter((t) => t.next && t.next <= hoje);

  // 2ª tentativa: nada vencido → pega o mais próximo de vencer
  if (candidatos.length === 0) {
    candidatos = topicos
      .filter((t) => t.next)
      .sort((a, b) => new Date(a.next) - new Date(b.next))
      .slice(0, 1);
  }

  // 3ª tentativa: nenhum tópico com ciclo de revisão → prioriza por exame/incidência
  if (candidatos.length === 0) {
    candidatos = (dados.topics || [])
      .slice()
      .sort((a, b) => {
        const rb = (b.examRank ? 11 - b.examRank : 0) - (a.examRank ? 11 - a.examRank : 0);
        if (rb !== 0) return rb;
        return (b.inc + b.imp) - (a.inc + a.imp);
      });
  }

  const escolhido = candidatos
    .map((t) => ({ t, s: scorePrioridade(hoje, t) }))
    .sort((a, b) => b.s - a.s)[0].t;

  const resultado = {
    tema: escolhido.tema || "",
    subtema: escolhido.sub || "",
    prioridade: Math.round(scorePrioridade(hoje, escolhido) * 10) / 10,
    questoes: questoesRecomendadas(dados.config, escolhido)
  };

  const dirApi = path.join(__dirname, "..", "api");
  fs.mkdirSync(dirApi, { recursive: true });
  fs.writeFileSync(path.join(dirApi, "revisao"), JSON.stringify(resultado, null, 2));

  console.log("Gerado /api/revisao:", resultado);
}

principal().catch((e) => {
  console.error("Erro ao gerar /api/revisao:", e);
  process.exit(1);
});
