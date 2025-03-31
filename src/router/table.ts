import express from "express";
import { auth } from "../middlewares";
import { createTable, deleteTable, getTables } from "../controllers/tables";

export default (router: express.Router) => {
  router.post("/table", createTable);
  router.get("/table", getTables)
  router.delete("/table/:id", deleteTable)
}