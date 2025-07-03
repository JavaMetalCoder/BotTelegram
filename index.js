import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import frasi from "./frasi.json" assert { type: "json" };
import libri from "./libri.json" assert { type: "json" };
import fs from "fs";
import cron from "node-cron";
import fetch from "node-fetch";
import express from "express";

dotenv.config();
const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();

// Middleware per webhook
app.use(express.json());
app.use(`/${process.env.BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body, res);
});

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

  if (simbolo === "USD" || simbolo === "EUR") {
    const res = await fetch("https://api.exchangerate.host/latest?base=EUR");
    const data = await res.json();
    return simbolo === "USD" ? data.rates.USD : 1;
  }

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${simbolo}&token=${finnhubKey}`);
  const data = await res.json();
  return data.c || null;
}

bot.start((ctx) => {
  salvaUtente(ctx.chat.id);
  const msg = `👋 *Benvenuto su FinanzaBot!*\n\nUsa i comandi:\n/giorno\n/libri\n/ai\n/donami\n/notizie\n/prezzo BTC\n/alert BTC 60000\n/myalerts\n/removealert BTC\n/cambio USD\n/info`;
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
  const msg = escapeMarkdownV2(`📊 *FinanzaBot* – Il tuo assistente finanziario personale su Telegram\n\n🧩 *Funzionalità disponibili:*\n• /giorno – Frase motivazionale + link utile\n• /libri – Consiglio di lettura finanziaria\n• /notizie – News su economia, lavoro, risparmio, crypto e geopolitica\n• /prezzo BTC – Consulta il prezzo di un asset\n• /alert BTC 60000 – Crea un alert\n• /myalerts – Visualizza i tuoi alert\n• /removealert BTC – Rimuovi un alert\n• /donami – Supporta il progetto 🙏\n• /cambio USD – Vedi EUR→USD\n\n🚀 *Funzionalità Premium (prossimamente):*\n• /ai – Consigli finanziari intelligenti personalizzati\n\n💡 *FinanzaBot è gratuito, indipendente e in continua espansione.*\nSupporta lo sviluppo: /donami\n\n📌 Powered by MetalCoder.dev {FZ}`);
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});

bot.command("ai", (ctx) => {
  const msg = escapeMarkdownV2("⚠️ Questa funzionalità sarà presto disponibile nel pacchetto *Premium*.\n\nPer ora ricevi un assaggio gratuito:\n\n\"Diversifica sempre.\"\n\n🔥 Per supportare lo sviluppo, usa /donami");
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});

bot.command("notizie", async (ctx) => {
  const url = `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_API_KEY}&category=business&language=it`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    const articoli = json.results.slice(0, 3);
    for (let art of articoli) {
      const titolo = escapeMarkdownV2(art.title);
      const link = escapeMarkdownV2(art.link);
      await ctx.reply(`🗞️ *${titolo}*\n🔗 ${link}`, { parse_mode: "MarkdownV2" });
    }
  } catch {
    ctx.reply("❌ Errore notizie.");
  }
});

bot.command("prezzo", async (ctx) => {
  const input = ctx.message.text.split(" ")[1];
  if (!input) return ctx.reply("📈 Scrivi `/prezzo BTC`", { parse_mode: "MarkdownV2" });
  const price = await fetchPrice(input);
  if (price) ctx.reply(`💰 *${input.toUpperCase()}*: *€${price}*`, { parse_mode: "MarkdownV2" });
  else ctx.reply("❌ Asset non trovato.");
});

bot.command("cambio", async (ctx) => {
  const valuta = ctx.message.text.split(" ")[1]?.toUpperCase();
  if (valuta !== "USD") return ctx.reply("💱 Usa `/cambio USD`", { parse_mode: "MarkdownV2" });
  const price = await fetchPrice("USD");
  if (price) ctx.reply(`💱 *1 EUR = ${price} USD*`, { parse_mode: "MarkdownV2" });
  else ctx.reply("❌ Errore nel recupero del cambio.");
});

bot.command("alert", async (ctx) => {
  const [rawAsset, rawTarget] = ctx.message.text.split(" ").slice(1);
  if (!rawAsset || !rawTarget || isNaN(rawTarget)) {
    return ctx.reply("❗ Usa: `/alert BTC 65000`", { parse_mode: "MarkdownV2" });
  }
  const alerts = getAlertList();
  alerts.push({ userId: ctx.chat.id, asset: rawAsset.toUpperCase(), target: parseFloat(rawTarget) });
  saveAlerts(alerts);
  ctx.reply(`✅ Alert salvato: *${rawAsset.toUpperCase()} ≥ €${rawTarget}*`, { parse_mode: "MarkdownV2" });
});

bot.command("myalerts", (ctx) => {
  const my = getAlertList().filter(a => a.userId === ctx.chat.id);
  if (my.length === 0) return ctx.reply("🔕 Nessun alert.");
  const msg = my.map(a => `- ${a.asset} ≥ €${a.target}`).join("\n");
  ctx.reply(`🔔 *I tuoi alert:*\n${msg}`, { parse_mode: "MarkdownV2" });
});

bot.command("removealert", (ctx) => {
  const asset = ctx.message.text.split(" ")[1]?.toUpperCase();
  if (!asset) return ctx.reply("❗ Usa: `/removealert BTC`", { parse_mode: "MarkdownV2" });
  const alerts = getAlertList();
  const filtered = alerts.filter(a => !(a.userId === ctx.chat.id && a.asset === asset));
  saveAlerts(filtered);
  ctx.reply(`🗑️ Rimosso alert per *${asset}*`, { parse_mode: "MarkdownV2" });
});

bot.command("donami", (ctx) => {
  const msg = `💸 *Supporta il progetto*\n\n☕  [PayPal](https://paypal.me/zagariafabio)`;
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});

// Avvia bot in modalità polling solo in dev
if (process.env.NODE_ENV !== "production") {
  bot.launch();
  console.log("🤖 Bot attivo in modalità polling");
}

// Avvia server Express
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ HTTP server webhook attivo");
});
