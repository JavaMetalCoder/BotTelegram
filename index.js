import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import frasi from "./frasi.json" assert { type: "json" };
import libri from "./libri.json" assert { type: "json" };
import fs from "fs";
import cron from "node-cron";
import fetch from "node-fetch";
import express from "express";
import bodyParser from "body-parser";

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

// Comandi
bot.start((ctx) => {
  salvaUtente(ctx.chat.id);
  const msg = `👋 *Benvenuto su FinanzaBot!*\n\nUsa i comandi:\n/giorno\n/libri\n/ai\n/notizie\n/prezzo BTC\n/alert BTC 60000\n/myalerts\n/removealert BTC\n/info\n\n📌 Powered by MetalCoder\\.dev {FZ}`;
  ctx.reply(escapeMarkdownV2(msg), { parse_mode: "MarkdownV2" });
});

bot.command("giorno", (ctx) => {
  const random = frasi[Math.floor(Math.random() * frasi.length)];
  const frase = escapeMarkdownV2(random.testo);
  const link = escapeMarkdownV2(random.link);
  ctx.reply(`💡 *Frase del giorno:*\n"${frase}"\n\n🔗 ${link}`, { parse_mode: "MarkdownV2" });
});

bot.command("libri", (ctx) => {
  const libro = escapeMarkdownV2(libri[Math.floor(Math.random() * libri.length)]);
  ctx.reply(`📘 *Consiglio di lettura:*\n${libro}`, { parse_mode: "MarkdownV2" });
});

bot.command("info", (ctx) => {
  const msg = escapeMarkdownV2(`📊 *FinanzaBot* – Il tuo assistente finanziario su Telegram

🧩 *Funzionalità disponibili:*
• /giorno – Frase motivazionale
• /libri – Libro consigliato
• /notizie – News su economia, crypto, lavoro, geopolitica
• /prezzo BTC – Prezzo di un asset
• /alert BTC 60000 – Crea alert personalizzato
• /myalerts – Visualizza alert
• /removealert BTC – Rimuovi alert

🚀 *In arrivo (Premium)*:
• /ai – Suggerimenti AI finanziari intelligenti

💸 *Supporta il progetto con /donami*
📌 Powered by MetalCoder\\.dev {FZ}`);
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});

bot.command("ai", (ctx) => {
  const msg = escapeMarkdownV2(`⚠️ Questa funzionalità sarà inclusa nel pacchetto *Premium*\n\nPer ora:\n🤖 "Evita le mode: segui la strategia, non l’isteria"\n\n🔥 Supporta con /donami`);
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});

bot.command("donami", (ctx) => {
  const msg = `💸 *Supporta il progetto*\n\n☕  [PayPal](https://paypal.me/zagariafabio)`;
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});

bot.command("notizie", async (ctx) => {
  const url = `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_API_KEY}&category=business,technology,top,politics&language=it`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    const articoli = json.results.filter(art =>
      /crypto|economia|risparmio|geopolitica|mercato|lavoro|bitcoin|ethereum/i.test(art.title + art.description)
    ).slice(0, 3);
    for (let art of articoli) {
      const titolo = escapeMarkdownV2(art.title);
      const link = escapeMarkdownV2(art.link);
      await ctx.reply(`🗞️ *${titolo}*\n🔗 ${link}`, { parse_mode: "MarkdownV2" });
    }
  } catch {
    ctx.reply("❌ Errore durante il recupero delle notizie.");
  }
});

bot.command("prezzo", async (ctx) => {
  const input = ctx.message.text.split(" ")[1];
  if (!input) return ctx.reply("📈 Scrivi `/prezzo BTC`", { parse_mode: "MarkdownV2" });
  const price = await fetchPrice(input);
  if (price) ctx.reply(`💰 *${input.toUpperCase()}*: *€${price}*`, { parse_mode: "MarkdownV2" });
  else ctx.reply("❌ Asset non trovato.");
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

// CRON: frase motivazionale alle 07:00
cron.schedule("0 7 * * *", async () => {
  const frase = frasi[Math.floor(Math.random() * frasi.length)];
  const msg = `💡 *Frase del giorno:*\n"${escapeMarkdownV2(frase.testo)}"\n\n🔗 ${escapeMarkdownV2(frase.link)}`;
  const utenti = getUtenti();
  for (const id of utenti) {
    try {
      await bot.telegram.sendMessage(id, msg, { parse_mode: "MarkdownV2" });
    } catch (err) {
      console.error(`Errore invio a ${id}:`, err.description);
    }
  }
});

// CRON: controlla gli alert ogni 5 min
cron.schedule("*/5 * * * *", async () => {
  const alerts = getAlertList();
  const prices = {};
  for (const alert of alerts) {
    if (!prices[alert.asset]) prices[alert.asset] = await fetchPrice(alert.asset);
    const prezzo = prices[alert.asset];
    if (prezzo >= alert.target) {
      try {
        await bot.telegram.sendMessage(alert.userId, `🔔 *ALERT: ${alert.asset} ≥ €${prezzo}*`, { parse_mode: "MarkdownV2" });
      } catch {}
    }
  }
});

// HTTP server per webhook Railway
const app = express();
app.use(bodyParser.json());
app.use(`/${process.env.BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body, res);
});
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ HTTP server webhook attivo");
});

// Avvio bot con webhook o polling
if (process.env.NODE_ENV === "production") {
  bot.launch({
    webhook: {
      domain: process.env.WEBHOOK_DOMAIN,
      hookPath: `/${process.env.BOT_TOKEN}`,
      port: process.env.PORT || 3000
    }
  });
  console.log("🤖 Bot attivo in modalità webhook");
} else {
  bot.launch();
  console.log("🤖 Bot attivo in modalità polling");
}
