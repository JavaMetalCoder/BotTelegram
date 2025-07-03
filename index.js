// ================================
//   FinanzaBot - index.js
//   Assistente finanziario Telegram
//   Powered by MetalCoder.dev {FZ}
// ================================

import { Telegraf, Markup, Scenes, session } from "telegraf";
import dotenv from "dotenv";
import express from "express";
import fs from "fs/promises";
import cron from "node-cron";
import fetch from "node-fetch";

// Dati statici
import frasi from "./frasi.json" assert { type: "json" };
import libri from "./libri.json" assert { type: "json" };

dotenv.config();
const PORT = process.env.PORT || 3000;

// ================================
//   In-Memory Stores & Helpers
// ================================
let utenti = [];
let alerts = [];

// Carica all’avvio
async function loadStores() {
  try {
    utenti = JSON.parse(await fs.readFile("./utenti.json", "utf-8"));
  } catch { utenti = []; }
  try {
    alerts = JSON.parse(await fs.readFile("./alert.json", "utf-8"));
  } catch { alerts = []; }
}
async function saveUsers() {
  await fs.writeFile("./utenti.json", JSON.stringify(utenti, null, 2));
}
async function saveAlerts() {
  await fs.writeFile("./alert.json", JSON.stringify(alerts, null, 2));
}

// Aggiunge utente solo in memoria + file
async function addUser(id) {
  if (!utenti.includes(id)) {
    utenti.push(id);
    await saveUsers();
  }
}

// Cache prezzi
const priceCache = new Map();
const PRICE_TTL = 60_000; // 60 s

async function fetchPrice(symbol) {
  const asset = symbol.toUpperCase();
  const now = Date.now();
  if (priceCache.has(asset)) {
    const { value, ts } = priceCache.get(asset);
    if (now - ts < PRICE_TTL) return value;
  }

  let value = null;
  const cgMap = { BTC: "bitcoin", ETH: "ethereum", DOT: "polkadot" };

  // Crypto
  if (cgMap[asset]) {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgMap[asset]}&vs_currencies=eur`
    );
    const data = await res.json();
    value = data[cgMap[asset]].eur;
  }
  // FX
  else if (asset === "USD" || asset === "EUR") {
    const res = await fetch("https://api.exchangerate.host/latest?base=EUR");
    const fx = await res.json();
    value = asset === "USD" ? fx.rates.USD : 1;
  }
  // PI
  else if (asset === "PI") {
    try {
      const res = await fetch(
        "https://api.xt.com/api/v4/public/market/ticker?symbol=pi_usdt"
      );
      const json = await res.json();
      value = parseFloat(json.result[0].last) || null;
    } catch {
      value = null;
    }
  }
  // Azioni/ETF
  else {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${asset}&token=${process.env.FINNHUB_API_KEY}`
    );
    const data = await res.json();
    value = data.c || null;
  }

  priceCache.set(asset, { value, ts: now });
  return value;
}

// Escape Markdown
function escapeMarkdownV2(text) {
  return text.replace(/([_*[\]()~`>#+=|{}.!\\-])/g, "\\$1");
}

// ================================
//   Setup Express (Webhook)
// ================================
const app = express();
app.use(express.json());

// ================================
//   Setup Telegraf Bot
// ================================
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());
app.use(`/${process.env.BOT_TOKEN}`, (req, res) =>
  bot.handleUpdate(req.body, res)
);

// ================================
//   Wizard Scene: Creazione Alert
// ================================
const { WizardScene, Stage } = Scenes;
const alertWizard = new WizardScene(
  "alert-wizard",
  (ctx) => {
    ctx.reply("📋 Quale asset monitorare? (es: BTC)");
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.session.asset = ctx.message.text.trim().toUpperCase();
    ctx.reply(`💬 Livello target per ${ctx.session.asset}?`);
    return ctx.wizard.next();
  },
  async (ctx) => {
    const target = parseFloat(ctx.message.text.trim());
    if (isNaN(target)) return ctx.reply("❗ Inserisci un numero valido.");
    alerts.push({ userId: ctx.chat.id, asset: ctx.session.asset, target });
    await saveAlerts();
    ctx.reply(`✅ Alert creato: ${ctx.session.asset} ≥ ${target}`);
    return ctx.scene.leave();
  }
);
const stage = new Stage([alertWizard]);
bot.use(stage.middleware());

// ================================
//   Comandi & Menu
// ================================
bot.start(async (ctx) => {
  await addUser(ctx.chat.id);
  ctx.reply(
    escapeMarkdownV2("👋 *Benvenuto!* Usa /menu per esplorare."),
    { parse_mode: "MarkdownV2" }
  );
});

bot.command("menu", (ctx) => {
  ctx.reply(
    "📋 *Menu Principale*",
    {
      parse_mode: "MarkdownV2",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("💡 Giorno", "giorno")],
        [Markup.button.callback("📚 Libri", "libri")],
        [Markup.button.callback("🗞️ Notizie", "news_menu")],
        [Markup.button.callback("🪙 Pi News", "pinotizie")],
        [Markup.button.callback("💰 Prezzo Asset", "prezzo_asset")],
        [Markup.button.callback("💱 Cambio EUR→USD", "cambio_usd")],
        [Markup.button.callback("🔔 Crea Alert", "alert_menu")],
        [Markup.button.callback("📊 I miei Alert", "myalerts")],
        [Markup.button.callback("🗑️ Rimuovi Alert", "removealert_menu")],
        [Markup.button.callback("ℹ️ Info", "info")],
        [Markup.button.callback("🙏 Supporto", "support")],
      ]),
    }
  );
});

bot.on("callback_query", async (ctx) => {
  const cmd = ctx.callbackQuery.data;
  await ctx.answerCbQuery();

  switch (cmd) {
    case "giorno": {
      const { testo, link } = frasi[Math.floor(Math.random() * frasi.length)];
      return ctx.editMessageText(
        `💡 *Frase del giorno:*\n${escapeMarkdownV2(testo)}\n🔗 ${escapeMarkdownV2(link)}`,
        { parse_mode: "MarkdownV2" }
      );
    }
    case "libri": {
      const libro = libri[Math.floor(Math.random() * libri.length)];
      return ctx.editMessageText(
        `📚 *Consiglio di lettura:*\n${escapeMarkdownV2(libro)}`,
        { parse_mode: "MarkdownV2" }
      );
    }
    case "news_menu":
      return ctx.editMessageText("➡️ Digita /notizie [argomento]");
    case "pinotizie":
      return sendPinews(ctx);
    case "prezzo_asset": {
      const asset = "BTC";
      const price = await fetchPrice(asset);
      return ctx.editMessageText(
        `💰 *${asset}*: *€${price}*`,
        { parse_mode: "MarkdownV2" }
      );
    }
    case "cambio_usd": {
      const rate = await fetchPrice("USD");
      return ctx.editMessageText(`💱 1 EUR = ${rate} USD`);
    }
    case "alert_menu":
      return ctx.scene.enter("alert-wizard");
    case "myalerts": {
      const mine = alerts.filter(a => a.userId === ctx.chat.id);
      if (!mine.length) return ctx.editMessageText("🔕 Nessun alert.");
      const text = mine.map(a => `- ${a.asset} ≥ €${a.target}`).join("\n");
      return ctx.editMessageText(`🔔 I tuoi alert:\n${text}`, { parse_mode: "MarkdownV2" });
    }
    case "removealert_menu":
      return ctx.editMessageText("➡️ Digita /removealert [asset]");
    case "info":
      return sendInfo(ctx);
    case "support":
      return ctx.editMessageText("🙏 Supporta MetalCoder.dev: /donami");
    default:
      return;
  }
});

// Gli altri comandi (/giorno, /libri, /notizie, /prezzo, etc.) rimangono inalterati...

// ================================
//   Cron Jobs (paralleli)
// ================================

// Frase del giorno alle 07:00
cron.schedule("0 7 * * *", async () => {
  const { testo, link } = frasi[Math.floor(Math.random() * frasi.length)];
  const ids = [...utenti];
  const tasks = ids.map(id =>
    bot.telegram.sendMessage(
      id,
      `💡 ${escapeMarkdownV2(testo)}\n🔗 ${escapeMarkdownV2(link)}`,
      { parse_mode: "MarkdownV2" }
    )
  );
  await Promise.all(tasks);
});

// Controllo alert ogni 5 minuti
cron.schedule("*/5 * * * *", async () => {
  const tasks = alerts.map(async (a) => {
    const price = await fetchPrice(a.asset);
    if (price >= a.target) {
      return bot.telegram.sendMessage(
        a.userId,
        `🔔 ALERT: ${a.asset} ≥ €${price}`
      );
    }
  });
  await Promise.all(tasks);
});

// ================================
//   Avvio Bot e Server
// ================================
loadStores().then(() => {
  bot.launch();
  app.listen(PORT, () => console.log(`✅ Webhook attivo su porta ${PORT}`));
});
