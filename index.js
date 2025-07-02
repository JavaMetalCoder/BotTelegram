import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import frasi from "./frasi.json" assert { type: "json" };
import libri from "./libri.json" assert { type: "json" };
import fs from "fs";
import cron from "node-cron";
import fetch from "node-fetch";

dotenv.config();
const bot = new Telegraf(process.env.BOT_TOKEN);

function escapeMarkdownV2(text) {
  return text.replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, "\\$1");
}

function getUtenti() {
  try {
    return JSON.parse(fs.readFileSync("./utenti.json"));
  } catch {
    return [];
  }
}

function salvaUtente(id) {
  const utenti = getUtenti();
  if (!utenti.includes(id)) {
    utenti.push(id);
    fs.writeFileSync("./utenti.json", JSON.stringify(utenti, null, 2));
    console.log(`👤 Nuovo utente loggato: ${id}`);
  }
}

function getAlertList() {
  try {
    return JSON.parse(fs.readFileSync("./alert.json"));
  } catch {
    return [];
  }
}

function saveAlerts(alerts) {
  fs.writeFileSync("./alert.json", JSON.stringify(alerts, null, 2));
}

async function fetchPrice(asset) {
  const simbolo = asset.toUpperCase();
  const coingeckoIds = { BTC: "bitcoin", ETH: "ethereum", DOT: "polkadot" };

  if (coingeckoIds[simbolo]) {
    const id = coingeckoIds[simbolo];
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=eur`);
    const data = await res.json();
    return data[id]?.eur;
  }

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${simbolo}&token=${finnhubKey}`);
  const data = await res.json();
  return data.c || null;
}

bot.start((ctx) => {
  salvaUtente(ctx.chat.id);
  const msg = `👋 *Benvenuto su FinanzaBot!*\n\nUsa i comandi:\n/giorno\n/libri\n/ai\n/donami\n/notizie\n/prezzo BTC\n/alert BTC 60000\n/myalerts\n/removealert BTC\n/info`;
  ctx.reply(escapeMarkdownV2(msg), { parse_mode: "MarkdownV2" });
});

bot.command("giorno", (ctx) => {
  const random = frasi[Math.floor(Math.random() * frasi.length)];
  const frase = escapeMarkdownV2(random.testo);
  const link = escapeMarkdownV2(random.link);
  ctx.reply(`💡 *Frase del giorno:*\n\"${frase}\"\n\n🔗 ${link}`, { parse_mode: "MarkdownV2" });
});

bot.command("libri", (ctx) => {
  const libro = escapeMarkdownV2(libri[Math.floor(Math.random() * libri.length)]);
  ctx.reply(`📘 *Consiglio di lettura:*\n${libro}`, { parse_mode: "MarkdownV2" });
});

bot.command("info", (ctx) => {
  const msg = escapeMarkdownV2(`📊 *FinanzaBot* – Il tuo assistente finanziario personale su Telegram\n\n🧩 *Funzionalità disponibili:*\n• /giorno – Frase motivazionale + link utile\n• /libri – Consiglio di lettura finanziaria\n• /notizie – News su economia, lavoro, risparmio, crypto e geopolitica\n• /prezzo BTC – Consulta il prezzo di un asset\n• /alert BTC 60000 – Crea un alert\n• /myalerts – Visualizza i tuoi alert\n• /removealert BTC – Rimuovi un alert\n• /donami – Supporta il progetto 🙏\n\n🚀 *Funzionalità Premium (prossimamente):*\n• /ai – Consigli finanziari intelligenti personalizzati\n\n💡 *FinanzaBot è gratuito, indipendente e in continua espansione.*\nSupporta lo sviluppo: /donami\n\n📌 Powered by MetalCoder.dev {FZ}`);
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});

bot.command("ai", (ctx) => {
  const msg = escapeMarkdownV2("⚠️ Questa funzionalità sarà presto disponibile nel pacchetto *Premium*.\n\nPer ora ricevi un assaggio gratuito:\n\n\"Diversifica sempre.\"\n\n🔥 Per supportare lo sviluppo, usa /donami");
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});
