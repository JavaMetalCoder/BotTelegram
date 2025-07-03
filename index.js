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
  try { return JSON.parse(fs.readFileSync("./utenti.json")); } catch { return []; }
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
  try { return JSON.parse(fs.readFileSync("./alert.json")); } catch { return []; }
}
function saveAlerts(alerts) {
  fs.writeFileSync("./alert.json", JSON.stringify(alerts, null, 2));
}

async function fetchPrice(asset) {
  const simbolo = asset.toUpperCase();
  const coingeckoIds = { BTC: "bitcoin", ETH: "ethereum", DOT: "polkadot" };
  if (coingeckoIds[simbolo]) {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoIds[simbolo]}&vs_currencies=eur`);
    const data = await res.json();
    return data[coingeckoIds[simbolo]]?.eur;
  }
  if (simbolo === "USD" || simbolo === "EUR") {
    const res = await fetch("https://api.exchangerate.host/latest?base=EUR");
    const data = await res.json();
    return simbolo === "USD" ? data.rates.USD : 1;
  }
  if (simbolo === "PI") {
    try {
      const res = await fetch("https://api.xt.com/api/v4/public/market/ticker?symbol=pi_usdt");
      const json = await res.json();
      const last = parseFloat(json.result[0]?.last);
      return isNaN(last) ? null : last;
    } catch { return null; }
  }
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${simbolo}&token=${finnhubKey}`);
  const data = await res.json();
  return data.c || null;
}

// /start
bot.start((ctx) => {
  salvaUtente(ctx.chat.id);
  ctx.reply(escapeMarkdownV2(`👋 *Benvenuto su FinanzaBot!*\n\nUsa i comandi:\n/giorno\n/libri\n/pinotizie [q]\n/notizie [q]\n/prezzo [asset]\n/cambio USD\n/alert BTC 60000\n/myalerts\n/removealert BTC\n/info`), { parse_mode: "MarkdownV2" });
});

// /giorno
bot.command("giorno", (ctx) => {
  const { testo, link } = frasi[Math.floor(Math.random() * frasi.length)];
  ctx.reply(`💡 *Frase del giorno:*\n"${escapeMarkdownV2(testo)}"\n\n🔗 ${escapeMarkdownV2(link)}`, { parse_mode: "MarkdownV2" });
});

// /libri
bot.command("libri", (ctx) => {
  const libro = libri[Math.floor(Math.random() * libri.length)];
  ctx.reply(`📘 *Consiglio di lettura:*\n${escapeMarkdownV2(libro)}`, { parse_mode: "MarkdownV2" });
});

// /info
bot.command("info", (ctx) => {
  const msg = `📊 *FinanzaBot* – Assistente finanziario su Telegram\n\n` +
    `• /giorno – Frase motivazionale\n` +
    `• /libri – Consiglio di lettura\n` +
    `• /notizie [q] – News su economia, lavoro, risparmio, geo, crypto\n` +
    `• /pinotizie – News su Pi Network\n` +
    `• /prezzo [asset] – Prezzo di asset (BTC, ETH, PI...)\n` +
    `• /cambio USD – Tasso EUR→USD\n` +
    `• /alert [asset] [target] – Crea alert\n` +
    `• /myalerts – I tuoi alert\n` +
    `• /removealert [asset] – Rimuovi alert\n` +
    `• /donami – Supporta il progetto 🙏\n\n` +
    `🚀 *Premium:* /ai – Suggerimenti AI (pross.)\n` +
    `📌 Powered by MetalCoderDev ---> t.me/MetalCoderDev`;
  ctx.reply(escapeMarkdownV2(msg), { parse_mode: "MarkdownV2" });
});

// /ai (Premium)
bot.command("ai", (ctx) => {
  ctx.reply(escapeMarkdownV2(`⚠️ Funzionalità *Premium* in arrivo!\nPx support: /donami`), { parse_mode: "MarkdownV2" });
});

// /donami
bot.command("donami", (ctx) => {
  ctx.reply(`💸 *Supporta il progetto*\n[PayPal](https://paypal.me/zagariafabio)`, { parse_mode: "MarkdownV2" });
});

// /notizie e /pinotizie
bot.command(["notizie","pinotizie"], async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const query = args.join(' ') || (ctx.match === 'pinotizie' ? 'pi network' : '');
  const url = `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_API_KEY}&language=it` + (query ? `&q=${encodeURIComponent(query)}` : '&category=business,crypto,politics');
  try {
    const res = await fetch(url);
    const json = await res.json();
    const items = json.results.slice(0,3);
    if (!items.length) return ctx.reply("❌ Nessuna notizia trovata.");
    for (let art of items) {
      await ctx.reply(`🗞️ *${escapeMarkdownV2(art.title)}*\n🔗 ${escapeMarkdownV2(art.link)}`, { parse_mode: "MarkdownV2" });
    }
  } catch {
    ctx.reply("❌ Errore recupero notizie.");
  }
});

// /prezzo e /cambio
bot.command("prezzo", async (ctx) => {
  const asset = ctx.message.text.split(' ')[1];
  if (!asset) return ctx.reply("📈 Usa /prezzo BTC", { parse_mode: "MarkdownV2" });
  const price = await fetchPrice(asset);
  if (!price) return ctx.reply("❌ Asset non trovato o non supportato.");
  const symbolUpper = asset.toUpperCase();
  const unit = symbolUpper === 'USD' ? 'USD' : symbolUpper === 'EUR' ? 'EUR' : symbolUpper === 'PI' ? 'USD' : '€';
  ctx.reply(`💰 *${symbolUpper}*: *${unit}${price}*`, { parse_mode: "MarkdownV2" });
});

bot.command("cambio", async (ctx) => {
  const cur = ctx.message.text.split(' ')[1]?.toUpperCase();
  if (cur !== 'USD') return ctx.reply("💱 Usa /cambio USD", { parse_mode: "MarkdownV2" });
  const rate = await fetchPrice('USD');
  ctx.reply(`💱 1 EUR = ${rate} USD`, { parse_mode: "MarkdownV2" });
});

// /alert
bot.command("alert", async (ctx) => {
  const [asset, target] = ctx.message.text.split(' ').slice(1);
  if (!asset || !target || isNaN(target)) return ctx.reply("❗ Usa /alert BTC 60000");
  const alerts = getAlertList();
  alerts.push({ userId: ctx.chat.id, asset: asset.toUpperCase(), target: parseFloat(target) });
  saveAlerts(alerts);
  ctx.reply(`✅ Alert: ${asset.toUpperCase()} >= €${target}`);
});

bot.command("myalerts", (ctx) => {
  const list = getAlertList().filter(a => a.userId===ctx.chat.id);
  if (!list.length) return ctx.reply("🔕 Nessun alert attivo.");
  const txt = list.map(a=>`- ${a.asset} >= €${a.target}`).join('\n');
  ctx.reply(`🔔 I tuoi alert:\n${txt}`, { parse_mode: "MarkdownV2" });
});

bot.command("removealert", (ctx) => {
  const asset = ctx.message.text.split(' ')[1]?.toUpperCase();
  if (!asset) return ctx.reply("❗ Usa /removealert BTC");
  let alerts = getAlertList();
  alerts = alerts.filter(a=>!(a.userId===ctx.chat.id && a.asset===asset));
  saveAlerts(alerts);
  ctx.reply(`🗑️ Alert rimosso: ${asset}`);
});

// CRON: frase giornaliera
cron.schedule("0 7 * * *", async () => {
  const { testo, link } = frasi[Math.floor(Math.random()*frasi.length)];
  for (const id of getUtenti()) {
    try { await bot.telegram.sendMessage(id, `💡 "${escapeMarkdownV2(testo)}"\n🔗 ${escapeMarkdownV2(link)}`, { parse_mode: "MarkdownV2" }); }
    catch {};
  }
});

// CRON: controllo alert ogni 5 min
cron.schedule("*/5 * * * *", async () => {
  const alerts = getAlertList();
  const cache = {};
  for (const a of alerts) {
    if (!cache[a.asset]) cache[a.asset] = await fetchPrice(a.asset);
    if (cache[a.asset]>=a.target) await bot.telegram.sendMessage(a.userId, `🔔 *ALERT*: ${a.asset} >= €${cache[a.asset]}`,{ parse_mode:"MarkdownV2" });
  }
});

// Avvia polling in dev
if (process.env.NODE_ENV!="production") { bot.launch(); console.log("🤖 Polling attivo"); }
// Avvia Express server
app.listen(process.env.PORT||3000,()=>console.log("✅ Webhook HTTP attivo"));
