import axios from "axios";
import fs from "fs";
//AP//Sem ATsum//Filtros padrão
// ============================
// CONFIGURAÇÃO
// ============================

const URL = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";

const payloadBase = {
  itensPorPagina: 1000,
  texto: "agravo de petição",
  dataDisponibilizacaoInicio: "2025-10-01",
  dataDisponibilizacaoFim: "2025-10-31",
};

const TRT_TO_ESTADO = {
  "01": "Rio de Janeiro",
  "02": "São Paulo",
  "03": "Minas Gerais",
  "04": "Rio Grande do Sul",
  "05": "Bahia",
  "06": "Pernambuco",
  "07": "Ceará",
  "08": "Pará",
  "09": "Paraná",
  "10": "Distrito Federal",
  "11": "Amazonas",
  "12": "Santa Catarina",
  "13": "Paraíba",
  "14": "Rondônia",
  "15": "São Paulo",
  "16": "Maranhão",
  "17": "Espírito Santo",
  "18": "Goiás",
  "19": "Alagoas",
  "20": "Sergipe",
  "21": "Rio Grande do Norte",
  "22": "Piauí",
  "23": "Mato Grosso",
  "24": "Mato Grosso do Sul",
};

// ============================
// ✅ TRTs bloqueados (skip + filtro)
// ============================
const TRTs_BLOQUEADOS = [
  ".13.",
  ".16.",
  ".19.",
  ".20.",
  ".21.",
  ".22.",
  ".04.",
  ".05.",
  ".07.",
  ".08.",
  ".11.",
  ".14.",
];

function trtEhBloqueadoPorNumero(numeroProc) {
  if (!numeroProc) return false;
  return TRTs_BLOQUEADOS.some((tok) => String(numeroProc).includes(tok));
}

function trtEhBloqueadoPorCodigo(trt2) {
  return TRTs_BLOQUEADOS.includes(`.${trt2}.`);
}

// ============================
// NORMALIZAÇÃO
// ============================

function norm(str = "") {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================
// ✅ FILTRO DE CLASSE: apenas excluir SUMARÍSSIMO
// ============================

const SUMARISSIMO_RE = /\bSUMARISSIMO\b/i;

function classeEhBloqueada(nomeClasseRaw) {
  const c = norm(nomeClasseRaw || "");
  if (!c) return false;
  return SUMARISSIMO_RE.test(c);
}

// ============================
// ✅ FILTROS "DA LISTAGEM" (PJ/bloqueios)
// ============================

const PJ_TERMS_RE =
  /\b(LTDA|L\.?T\.?D\.?A\.?|LIMITADA|EMPRESA|COMERCIO|INDUSTRIA|SERVICOS|DISTRIBUIDORA|FABRICA|USINA|INCORPORADORA|CONSTRUTORA|CONSULTORIA|CONSORCIO|HOLDING|LABORATORIO|CLINICA|TRANSPORTE|TRANSPORTES|SUPERMERCADO|MERCADO|PADARIA|AUTOPECAS|OFICINA|REPRESENTACAO|REPRESENTACOES|AGROPECUARIA|AGRO|AGRICOLA|EIRELI|CAIXA ECONOMICA|COLEGIO|BANCO|BRADESCO|ITA(U|Ú)|SANTANDER|PETROBRAS|ELETROBRAS|ELETRONUCLEAR|COMPANIA|CIA|CVC)\b/;

const SA_TOKEN_RE = /\bS\s*[\.\/]?\s*A\b|\bSA\b/;
const EPP_TOKEN_RE = /\bE\s*\.?\s*P\s*\.?\s*P\b/;
const ME_TOKEN_RE = /\bM\s*\.?\s*E\b/;
const MEI_TOKEN_RE = /\bM\s*\.?\s*E\s*\.?\s*I\b/;
const SS_TOKEN_RE = /\bS\s*\/\s*S\b/;
const SLP_TOKEN_RE = /\bS\s*\/\s*L\s*P\b/;

const BLOQUEIO_PUBLICO_RE = new RegExp(
  "\\b(" +
    [
      "MINISTERIO",
      "MUNICIPIO",
      "PREFEITURA",
      "ESTADO",
      "UNIAO",
      "UNIÃO",
      "GOVERNO",
      "SECRETARIA",
      "TRIBUNAL",
      "PROCURADORIA",
      "FUNDACAO",
      "FUNDAÇÃO",
      "EMPRESA\\s+BRASILEIRA",
      "EMPRESA\\s+DE\\s+CORREIOS",
      "CORREIOS",
      "PETROBRAS",
      "ELETROBRAS",
      "EMBRAPA",
      "EMBRATEL",
      "CAIXA\\s+ECONOMICA",
      "BANCO\\s+DO\\s+BRASIL",
      "BNDES",
      "INSS",
      "RECEITA",
      "POLICIA",
      "UNIVERSIDADE",
      "ESCOLA",
      "INSTITUTO",
      "\\bIF\\b",
      "AUTARQUIA",
      "CASA\\s+DA\\s+MOEDA",
      "SERVICO\\s+PUBLICO",
      "SERVIÇO\\s+PUBLICO",
      "ADMINISTRACAO",
      "ADMINISTRAÇÃO",
      "DETRAN",
      "DNIT",
      "SUFRAMA",
      "ANATEL",
      "ANVISA",
      "COMPANHIA",
      "METRO",
      "METRÔ",
      "UBER",
      "\\b99\\b",
      "IFOOD",
      "RAPPI",
      "LOGGI",
      "CABIFY",
    ].join("|") +
    ")\\b",
  "i"
);

const BLOQUEIO_RECUP_RE =
  /\b(RECUPERACAO|RECUPERAÇÃO|FALENCIA|FALÊNCIA|MASSA\s+FALIDA)\b/i;

function isPJ(nome) {
  if (!nome) return false;
  const n = norm(nome);
  if (BLOQUEIO_RECUP_RE.test(n)) return false;
  if (BLOQUEIO_PUBLICO_RE.test(n)) return false;
  return (
    PJ_TERMS_RE.test(n) ||
    SA_TOKEN_RE.test(n) ||
    EPP_TOKEN_RE.test(n) ||
    ME_TOKEN_RE.test(n) ||
    MEI_TOKEN_RE.test(n) ||
    SS_TOKEN_RE.test(n) ||
    SLP_TOKEN_RE.test(n)
  );
}

// ============================
// AUXILIARES DE PROCESSO
// ============================

function getTRTFromNumero(numero) {
  if (!numero || typeof numero !== "string") return null;
  const match = numero.match(/\.(\d{2})\.\d{4}$/);
  if (match) return match[1];
  return null;
}

function getEstadoFromNumero(numero) {
  const trt = getTRTFromNumero(numero);
  if (trt) return TRT_TO_ESTADO[trt] || "—";
  return "—";
}

function extractFromTexto(texto = "") {
  const recA =
    /(?:Reclamante|Recorrente)\s*:\s*([^\n]+)/i.exec(texto)?.[1]?.trim() ||
    null;
  const recP =
    /(?:Reclamado|Recorrido)\s*:\s*([^\n]+)/i.exec(texto)?.[1]?.trim() ||
    null;
  return { reclamante: recA, reclamada: recP };
}

function parseProcesso(item) {
  let reclamante = null;
  let reclamada = null;

  if (Array.isArray(item.destinatarios)) {
    const ativo = item.destinatarios.find((d) => d.polo === "A");
    const passivo = item.destinatarios.find((d) => d.polo === "P");
    if (ativo) reclamante = ativo.nome;
    if (passivo) reclamada = passivo.nome;
  }

  if ((!reclamante || !reclamada) && item.texto) {
    const extra = extractFromTexto(item.texto);
    reclamante = reclamante || extra.reclamante;
    reclamada = reclamada || extra.reclamada;
  }

  const numero =
    item.numeroprocessocommascara || item.numeroProcessoComMascara || null;

  const nomeClasse =
    item.nomeClasse ||
    item.nome_classe ||
    item.classe ||
    item.nomeClasseProcesso ||
    null;

  const estado = getEstadoFromNumero(numero);
  const trt = getTRTFromNumero(numero);

  return {
    nomeClasse,
    classeProcesso: item.nomeClasse || item.codigoClasse || "AGP",
    numero_processo: numero,
    trt, // ✅ adiciona TRT no output
    estado,
    reclamante,
    reclamada,
  };
}

// ============================
// USADOS (compartilhado)
// ============================

function carregarUsados() {
  let usados = [];
  if (fs.existsSync("usados.json")) {
    try {
      usados = JSON.parse(fs.readFileSync("usados.json", "utf-8"));
    } catch {
      usados = [];
    }
  }
  return new Set((usados || []).map(norm));
}

function salvarUsados(usadosSet) {
  fs.writeFileSync(
    "usados.json",
    JSON.stringify(Array.from(usadosSet), null, 2),
    "utf-8"
  );
}

// ============================
// COLETA POR TRT (RETORNA RESULTADOS)
// ============================

async function coletarProcessosPorTRT(trt2, usadosSet) {
  const siglaTribunal = `TRT${Number(trt2)}`; // "TRT01" -> "TRT1"

  if (trtEhBloqueadoPorCodigo(trt2)) {
    console.log(`⛔ Pulando ${siglaTribunal} (bloqueado)`);
    return { trt2, siglaTribunal, resultados: [], paginas: 0, totalLista: 0 };
  }

  console.log(`\n🚀 Iniciando coleta em ${siglaTribunal}`);

  const resultados = [];
  const limitePaginas = 200;
  let pagina = 101;
  let totalLista = 0;

  while (pagina <= limitePaginas) {
    console.log(`🔎 ${siglaTribunal} → página ${pagina}...`);

    try {
      const { data } = await axios.get(URL, {
        params: { ...payloadBase, siglaTribunal, pagina },
        headers: {
          Accept: "application/json, text/plain, */*",
          Referer: "https://comunica.pje.jus.br/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
        },
      });

      const lista = data.conteudo || data.items || [];
      if (!lista.length) {
        console.log(`${siglaTribunal} → sem resultados. Encerrando.`);
        break;
      }

      totalLista += lista.length;

      let incluidosNaPagina = 0;

      for (const item of lista) {
        const proc = parseProcesso(item);

        if (classeEhBloqueada(proc.nomeClasse)) continue;

        if (!proc.reclamante || !proc.reclamada) continue;
        if (!proc.numero_processo) continue;

        // ✅ filtro TRT bloqueado pelo número
        if (trtEhBloqueadoPorNumero(proc.numero_processo)) continue;

        const key = norm(proc.numero_processo);
        if (usadosSet.has(key)) continue;

        const ativoEhPJ = isPJ(proc.reclamante);
        const passivoEhPJ = isPJ(proc.reclamada);

        if (!ativoEhPJ || passivoEhPJ) continue;

        resultados.push(proc);
        usadosSet.add(key);
        incluidosNaPagina++;
      }

      console.log(
        `📄 ${siglaTribunal} pág ${pagina} → ${lista.length} regs | aceitos: ${incluidosNaPagina} | total TRT: ${resultados.length}`
      );

      pagina++;
      await sleep(3000);
    } catch (err) {
      console.error(
        `❌ Erro em ${siglaTribunal} pág ${pagina}:`,
        err.response?.status || err.message
      );
      break;
    }
  }

  return { trt2, siglaTribunal, resultados, paginas: pagina - 1, totalLista };
}

// ============================
// LOOP TRT01..TRT24 -> UM ARQUIVO FINAL
// ============================

async function coletarTodosTRTs() {
  const usadosSet = carregarUsados();

  const todosTRTs = Array.from({ length: 24 }, (_, i) =>
    String(i + 1).padStart(2, "0")
  );
 /* const todosTRTs = Array.from({ length: 13 }, (_, i) =>
  String(i + 12).padStart(2, "0")
);*/


  console.log("📌 TRTs bloqueados:", TRTs_BLOQUEADOS.join(" "));
  console.log("📘 usados.json (inicial):", usadosSet.size, "regs\n");

  const resultadosGerais = [];
  const resumoPorTRT = [];

  for (const trt2 of todosTRTs) {
    const r = await coletarProcessosPorTRT(trt2, usadosSet);

    // agrega resultados
    resultadosGerais.push(...r.resultados);

    // resumo (pra debug/controle)
    resumoPorTRT.push({
      trt: r.siglaTribunal,
      paginas: r.paginas,
      totalNaAPI: r.totalLista,
      aceitos: r.resultados.length,
      bloqueado: trtEhBloqueadoPorCodigo(trt2),
    });
  }

  salvarUsados(usadosSet);

  // ✅ arquivo único final
  const filename = `todos_trts_agravo_filtrado_${payloadBase.dataDisponibilizacaoInicio}_${payloadBase.dataDisponibilizacaoFim}.json`;

  fs.writeFileSync(
    filename,
    JSON.stringify(
      {
        meta: {
          texto: payloadBase.texto,
          inicio: payloadBase.dataDisponibilizacaoInicio,
          fim: payloadBase.dataDisponibilizacaoFim,
          total_aceitos: resultadosGerais.length,
          usados_total: usadosSet.size,
          trts_bloqueados: TRTs_BLOQUEADOS,
        },
        resumo_por_trt: resumoPorTRT,
        resultados: resultadosGerais,
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`\n🏁 TOTAL GERAL (aceitos): ${resultadosGerais.length}`);
  console.log(`💾 Arquivo único salvo: ${filename}`);
  console.log(`📘 usados.json atualizado: ${usadosSet.size} registros`);
  if (resultadosGerais[0]) console.log("Exemplo:", resultadosGerais[0]);
}

coletarTodosTRTs();
