import "./env.js";
import { buildApp } from "./app.js";

const app = buildApp();

const port = Number(process.env.PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log("API ready on :" + port);
});
