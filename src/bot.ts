import dotenv from "dotenv";
dotenv.config();
import fetch from "node-fetch";

import express from "express";
import Database from "better-sqlite3";

const PORT = process.env.PORT || 6000;

const initTable = `
CREATE TABLE IF NOT EXISTS 'cotizacion_actual' (
	'time' TIMESTAMP(12),
	'oficial' DOUBLE(12),
	'solidario' DOUBLE(12),
	'blue' DOUBLE(12),
	'mep' DOUBLE(12),
	'ccl' DOUBLE(12),
	'dai' DOUBLE(12) );
  CREATE TABLE IF NOT EXISTS 'cotizacion_historico' (
  'time' TIMESTAMP(12),
  'oficial' DOUBLE(12),
  'solidario' DOUBLE(12),
  'blue' DOUBLE(12),
  'mep' DOUBLE(12),
  'ccl' DOUBLE(12),
  'dai' DOUBLE(12)
);`;

const db = new Database("db.sqlite", { verbose: console.log });
const stm = db.prepare(
  "INSERT INTO cotizacion_actual (oficial, solidario, blue, mep, ccl, dai, time) VALUES (?, ?, ?, ?, ?, ?, ?)"
);

const selectActual = db.prepare(
  "SELECT * FROM cotizacion_actual WHERE time BETWEEN ? AND ?"
);

db.exec(initTable);

const app = express();

app.get("/", (_req: any, res) => {
  res.send("HEELLLOOOO");
});

app.get("/scrap", async (_req: any, res) => {
  const response = await fetch("https://criptoya.com/api/dolar", {
    method: "get",
  });

  const { oficial, solidario, blue, mep, ccl, time } = await response.json();

  const responseDai = await fetch(
    "https://criptoya.com/api/binancep2p/buy/dai/ars/10",
    { method: "get" }
  );
  const { data } = await responseDai.json();
  const dai =
    data
      .map((r: { adv: { price: number } }) => Number(r.adv.price))
      .reduce((prev: number, curr: number) => (curr += prev)) / data.length;

  stm.run(oficial, solidario, blue, mep, ccl, dai, time);
  res.send({ oficial, solidario, blue, mep, ccl, dai, time });
});

app.get("/day", async (_req: any, res) => {
  const from = parseInt(
    (
      new Date(new Date().toISOString().slice(0, 11) + "00:00:00").getTime() /
      1000
    ).toFixed(0)
  );

  const to = parseInt(
    (
      new Date(new Date().toISOString().slice(0, 11) + "24:00:00").getTime() /
      1000
    ).toFixed(0)
  );

  const data = selectActual.all(from, to);
  console.log(data);
  res.send(data.length ? data[0] : {});
});

app.listen(PORT, () => console.log(`Listening on ${PORT}`));
