import dotenv from "dotenv";
dotenv.config();

import express from "express";
import Database from "better-sqlite3";
import axios from "axios";

const PORT = process.env.PORT || 6000;

const toTimeStamp = (time: string) =>
  parseInt((new Date(time).getTime() / 1000).toFixed(0));

const calcVariation = (key: string, arr: Array<{ [key: string]: number }>) => {
  return Number((((arr[1][key] - arr[0][key]) / arr[0][key]) * 100).toFixed(2));
};

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

const db = new Database("db.sqlite", {
  verbose: console.log,
  fileMustExist: true,
});
db.exec(initTable);

const stm = db.prepare(
  "INSERT INTO cotizacion_actual (oficial, solidario, blue, mep, ccl, dai, time) VALUES (?, ?, ?, ?, ?, ?, ?)"
);

const migrate = db.prepare(
  `INSERT INTO cotizacion_historico (oficial, solidario, blue, mep, ccl, dai, time) VALUES (?, ?, ?, ?, ?, ?, ?);`
);

const deleteOld = db.prepare(
  "DELETE FROM cotizacion_actual WHERE time BETWEEN ? AND ?;"
);

const selectActual = db.prepare(
  `SELECT time,
    AVG(oficial) as oficial,
    AVG(solidario) as solidario,
    AVG(blue) as blue,
    AVG(mep) as mep,
    AVG(ccl) as ccl,
    AVG(dai) as dai 
  FROM cotizacion_actual WHERE time BETWEEN ? AND ?`
);

const getVariations = db.prepare(`
SELECT oficial, solidario, blue, mep, ccl, dai
  FROM cotizacion_historico WHERE time = ?
    UNION ALL 
SELECT 
  AVG(oficial) as oficial,
  AVG(solidario) as solidario,
  AVG(blue) as blue,
  AVG(mep) as mep,
  AVG(ccl) as ccl,
  AVG(dai) as dai  
FROM cotizacion_actual WHERE time BETWEEN ? AND ?
  `);

interface IRipioData {
  buy_rate: string;
  sell_rate: string;
  ticker: string;
  variation: string;
}

const app = express();

app.get("/", (_req: any, res) => {
  res.send("HEELLLOOOO");
});

app.get("/backup", (_req: any, res) => {
  db.backup(`bkp/backup-${Date.now()}.sqlite`)
    .then(() => {
      console.log("backup complete!");
    })
    .catch((err) => {
      console.log("backup failed:", err);
    });
  res.send("backup in progress");
});

app.get("/scrap", async (_req: any, res) => {
  const time = new Date().getTime() / 1000;

  const [response, { data }, { data: dataCCL }, { data: dataMEP }] =
    await Promise.all([
      axios.get("https://api.bluelytics.com.ar/v2/latest"),
      axios.get("https://app.ripio.com/api/v3/public/rates/?country=AR"),
      axios.get("https://api-dolar-argentina.herokuapp.com/api/contadoliqui"),
      axios.get("https://api-dolar-argentina.herokuapp.com/api/dolarbolsa"),
    ]);

  /*   const response = await axios.get("https://api.bluelytics.com.ar/v2/latest");

  const { data } = await axios.get(
    "https://app.ripio.com/api/v3/public/rates/?country=AR"
  );

  const { data: dataCCL } = await axios.get(
    "https://api-dolar-argentina.herokuapp.com/api/contadoliqui"
  );

  const { data: dataMEP } = await axios.get(
    "https://api-dolar-argentina.herokuapp.com/api/dolarbolsa"
  );
 */

  const { oficial, blue } = response.data as any;
  const solidario = oficial.value_sell * 1.65;

  const dai = Number(
    data.filter((item: IRipioData) => item.ticker === "DAI_ARS").pop().buy_rate
  );

  const today = new Date().toISOString().slice(0, 11);
  let tomorrow: string | Date = new Date();
  tomorrow.setDate(tomorrow.getDate() - 2);
  tomorrow = tomorrow.toISOString().slice(0, 11);

  const from = toTimeStamp(today + "00:00:00");
  const tomorrow_date = toTimeStamp(tomorrow + "24:00:00");

  const prevData = selectActual.all(tomorrow_date, from).pop();

  if (prevData.oficial) {
    const { oficial, solidario, blue, mep, ccl, dai } = prevData;
    migrate.run(oficial, solidario, blue, mep, ccl, dai, tomorrow_date);
    deleteOld.run(tomorrow_date, from);
  }

  console.log("scrap result:", {
    oficial: oficial.value_sell,
    solidario,
    blue: blue.value_sell,
    mep: Number(dataMEP.compra),
    ccl: Number(dataCCL.compra),
    dai,
    time,
  });

  stm.run(
    oficial.value_sell,
    solidario,
    blue.value_sell,
    Number(dataMEP.compra),
    Number(dataCCL.compra),
    dai,
    time
  );

  res.send({
    oficial: oficial.value_sell,
    solidario,
    blue: blue.value_sell,
    mep: Number(dataMEP.compra),
    ccl: Number(dataCCL.compra),
    dai,
    time,
  });
});

app.get("/day", async (_req: any, res) => {
  const today = new Date().toISOString().slice(0, 11);
  let tomorrow: string | Date = new Date();
  tomorrow.setDate(tomorrow.getDate() - 2);
  tomorrow = tomorrow.toISOString().slice(0, 11);

  const from = toTimeStamp(today + "00:00:00");
  const to = toTimeStamp(today + "24:00:00");
  const tomorrow_date = toTimeStamp(tomorrow + "24:00:00");

  const data = selectActual.all(from, to)?.pop() ?? {};
  const prevData = selectActual.all(tomorrow_date, from).pop();

  if (prevData.oficial) {
    const { oficial, solidario, blue, mep, ccl, dai } = prevData;
    migrate.run(oficial, solidario, blue, mep, ccl, dai, tomorrow_date);
    deleteOld.run(tomorrow_date, from);
  }

  const variations = getVariations.all(tomorrow_date, from, to);
  let resultData;
  if (variations[1]?.oficial) {
    resultData = {
      ...data,
      variations: {
        oficial: calcVariation("oficial", variations),
        solidario: calcVariation("solidario", variations),
        blue: calcVariation("blue", variations),
        mep: calcVariation("mep", variations),
        ccl: calcVariation("ccl", variations),
        dai: calcVariation("dai", variations),
      },
    };
  } else {
    resultData = data;
  }

  res.send(data.dai ? resultData : {});
});

app.listen(PORT, () => console.log(`Listening on ${PORT}`));
