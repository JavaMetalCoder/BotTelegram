// ================================
//   FinanzaBot - index.js
//   Assistente finanziario Telegram
//   Powered by MetalCoder.dev {FZ}
// ================================

import { Telegraf, Markup, Scenes, session } from "telegraf";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import cron from "node-cron";
import fetch from "node-fetch";

// Dati statici
import frasi from "./frasi.json" assert { type: "json" };
import libri from "./libri.json" assert { type: "json" };

// ================================
//   Configurazione ambiente
// ================================
dotenv.config();
const PORT = process.env.PORT || 3000;

// ================================
//   Setup Express (Webhook)
// ================================
const app = express();
app.use(express.json());

// Il bot verrà definito dopo questa riga, quindi possiamo collegare il webhook
let bot;

// ================================
//   Setup Telegraf Bot
// ================================
function setupBot() {
  bot = new Telegraf(process.env.BOT_TOKEN);
  bot.use(session());

  // Webhook: riceve update da Telegram
  app.use(`/${process.env.BOT_TOKEN}`, (req, res) => {
    bot.handleUpdate(req.body, res);
  });
}

// ================================
//   Utility Functions
// ================================

/**
 * Escapes special characters for MarkdownV2
 */
function escapeMarkdownV2(text) {
  return text.replace(/([_*[\]()~`>#+=|{}.!\\-])/g, "\\$1");
}

/**
 * Fetches price for various assets: crypto, FX, Pi coin
 */
async function fetchPrice(symbol) {
  const asset = symbol.toUpperCase();
  const cgMap = { BTC: "bitcoin", ETH: "ethereum", DOT: "polkadot" };

  // Crypto via CoinGecko
  if (cgMap[asset]) {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgMap[asset]}&vs_currencies=eur`
    );
    const data = await res.json();
    return data[cgMap[asset]].eur;
  }

  // FX EUR↔USD via exchangerate.host
  if (asset === "USD" || asset === "EUR") {
    const res = await fetch("https://api.exchangerate.host/latest?base=EUR");
    const fx = await res.json();
    return asset === "USD" ? fx.rates.USD : 1;
  }

  // Pi Coin (API non ufficiale)
  if (asset === "PI") {
    try {
      const res = await fetch(
        "https://api.xt.com/api/v4/public/market/ticker?symbol=pi_usdt"
      );
      const json = await res.json();
      return parseFloat(json.result[0].last) || null;
    } catch {
      return null;
    }
  }

  // Azioni/ETF via Finnhub
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${asset}&token=${process.env.FINNHUB_API_KEY}`
  );
  const data = await res.json();
  return data.c || null;
}

// ================================
//   Wizard Scene: Creazione Alert
// ================================
const { WizardScene, Stage } = Scenes;
const alertWizard = new WizardScene(
  "alert-wizard",
  (ctx) => {
    ctx.reply("📋 Quale asset desideri monitorare? (es: BTC)");
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.session.asset = ctx.message.text.trim().toUpperCase();
    ctx.reply(`💬 Inserisci il livello target per ${ctx.session.asset}`);
    return ctx.wizard.next();
  },
  (ctx) => {
    const target = parseFloat(ctx.message.text.trim());
    if (isNaN(target)) {
      return ctx.reply("❗ Valore non valido, inserisci un numero.");
    }
    const alerts = JSON.parse(fs.readFileSync("./alert.json", "utf-8") || "[]");
    alerts.push({ userId: ctx.chat.id, asset: ctx.session.asset, target });
    fs.writeFileSync("./alert.json", JSON.stringify(alerts, null, 2));
    ctx.reply(`✅ Alert creato: ${ctx.session.asset} ≥ ${target}`);
    return ctx.scene.leave();
  }
);
const stage = new Stage([alertWizard]);

// ================================
//   Comandi Bot
// ================================
function registerCommands() {
  bot.use(stage.middleware());

  // /start
  bot.start((ctx) => {
    const welcome =
      "👋 *Benvenuto in FinanzaBot!* \nUsa /menu per esplorare le funzionalità.";
    ctx.reply(escapeMarkdownV2(welcome), { parse_mode: "MarkdownV2" });
  });

  // /menu
  bot.command("menu", (ctx) => {
    ctx.reply(
      "📋 *Menu Principale*",
      {
        parse_mode: "MarkdownV2",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("💱 Cambio EUR→USD", "cambio_usd")],
          [Markup.button.callback("💰 Prezzo Asset", "prezzo_asset")],
          [Markup.button.callback("🗞️ Notizie", "news_menu")],
          [Markup.button.callback("🔔 Crea Alert", "alert_menu")],
          [Markup.button.callback("🪙 Pi Network", "pinotizie")]
        ])
      }
    );
  });

  // Callback queries
  bot.on("callback_query", async (ctx) => {
    const cmd = ctx.callbackQuery.data;
    await ctx.answerCbQuery();
    switch (cmd) {
      case "cambio_usd": {
        const rate = await fetchPrice("USD");
        return ctx.editMessageText(`💱 1 EUR = ${rate} USD`);
      }
      case "prezzo_asset":
        return ctx.editMessageText("➡️ Digita /prezzo [asset], es: /prezzo BTC");
      case "news_menu":
        return ctx.editMessageText("➡️ Digita /notizie [argomento], es: /notizie crypto");
      case "alert_menu":
        return ctx.scene.enter("alert-wizard");
      case "pinotizie":
        return ctx.editMessageText("➡️ Eseguo /pinotizie");
      default:
        return;
    }
  });

  // /notizie e /pinotizie
  bot.command(["notizie", "pinotizie"], async (ctx) => {
    const args = ctx.message.text.split(" ").slice(1);
    const query = args.length
      ? args.join(" ")
      : ctx.match === "pinotizie"
      ? "pi network"
      : "";
    const url =
      `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_API_KEY}` +
      (query
        ? `&q=${encodeURIComponent(query)}`
        : "&category=business,crypto,politics");
    try {
      const res = await fetch(url);
      const data = await res.json();
      const items = data.results.slice(0, 3);
      if (!items.length) return ctx.reply("❌ Nessuna notizia trovata.");
      for (let art of items) {
        ctx.reply(
          `🗞️ *${escapeMarkdownV2(art.title)}* \n🔗 ${escapeMarkdownV2(art.link)}`,
          { parse_mode: "MarkdownV2" }
        );
      }
    } catch {
      ctx.reply("❌ Errore nel recupero delle notizie.");
    }
  });

  // /prezzo
  bot.command("prezzo", async (ctx) => {
    const asset = ctx.message.text.split(" ")[1];
    if (!asset) return ctx.reply("❗ Usa /prezzo [asset], es: /prezzo BTC");
    const price = await fetchPrice(asset);
    if (!price) return ctx.reply("❌ Asset non supportato o non trovato.");
    const unit = asset.toUpperCase() === "USD" ? "USD" : "€";
    ctx.reply(
      `💰 *${asset.toUpperCase()}*: *${unit}${price}*`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // /cambio
  bot.command("cambio", async (ctx) => {
    const cur = ctx.message.text.split(" ")[1]?.toUpperCase();
    if (cur !== "USD") return ctx.reply("❗ Usa /cambio USD");
    const rate = await fetchPrice("USD");
    ctx.reply(`💱 1 EUR = ${rate} USD`);
  });

  // /myalerts
  bot.command("myalerts", (ctx) => {
    const list = JSON.parse(fs.readFileSync("./alert.json", "utf-8") || "[]");
    const mine = list.filter((a) => a.userId === ctx.chat.id);
    if (!mine.length) return ctx.reply("🔕 Nessun alert attivo.");
    const text = mine.map((a) => `- ${a.asset} ≥ €${a.target}`).join("\n");
    ctx.reply(`🔔 I tuoi alert:\n${text}`, { parse_mode: "MarkdownV2" });
  });

  // /removealert
  bot.command("removealert", (ctx) => {
    const asset = ctx.message.text.split(" ")[1]?.toUpperCase();
    if (!asset) return ctx.reply("❗ Usa /removealert [asset]");
    let list = JSON.parse(fs.readFileSync("./alert.json", "utf-8") || "[]");
    list = list.filter((a) => !(a.userId === ctx.chat.id && a.asset === asset));
    fs.writeFileSync("./alert.json", JSON.stringify(list, null, 2));
    ctx.reply(`🗑️ Alert rimosso: ${asset}`);
  });

  // /donami
  bot.command("donami", (ctx) => {
    ctx.reply(
      "💸 *Supporta il progetto*\n\n[PayPal](https://paypal.me/zagariafabio)",
      { parse_mode: "MarkdownV2" }
    );
  });
}

// ================================
//   Cron Jobs
// ================================

// Frase del giorno alle 07:00
cron.schedule("0 7 * * *", async () => {
  const { testo, link } = frasi[Math.floor(Math.random() * frasi.length)];
  const ids = JSON.parse(fs.readFileSync("./utenti.json", "utf-8") || "[]");
  for (let id of ids) {
    await bot.telegram.sendMessage(
      id,
      `💡 ${escapeMarkdownV2(testo)}\n🔗 ${escapeMarkdownV2(link)}`,
      { parse_mode: "MarkdownV2" }
    );
  }
});

// Controllo alert ogni 5 minuti
cron.schedule("*/5 * * * *", async () => {
  const list = JSON.parse(fs.readFileSync("./alert.json", "utf-8") || "[]");
  const cache = {};
  for (let a of list) {
    if (!cache[a.asset]) cache[a.asset] = await fetchPrice(a.asset);
    if (cache[a.asset] >= a.target) {
      await bot.telegram.sendMessage(
        a.userId,
        `🔔 ALERT: ${a.asset} ≥ €${cache[a.asset]}`
      );
    }
  }
});

// ================================
//   Avvio Bot e Server
// ================================
setupBot();
registerCommands();

if (process.env.NODE_ENV !== "production") {
  bot.launch();
  console.log("🤖 Polling attivo");
}

app.listen(PORT, () => {
  console.log(`✅ Webhook attivo su porta ${PORT}`);
});
